#!/usr/bin/env tsx
/**
 * Phase 6 engine load test — seeds enrollments, runs concurrent workers, asserts invariants.
 *
 * Usage:
 *   pnpm tsx scripts/load-test-engine.ts --workspaces=3 --enrollments=100 --workers=2 --duration=120
 *   pnpm tsx scripts/load-test-engine.ts --test-mode=permanent-failure
 *   pnpm tsx scripts/load-test-engine.ts --test-mode=outer-rollback
 *   pnpm tsx scripts/load-test-engine.ts --test-mode=suppression-during-run
 */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvFile(): void {
  try {
    const raw = readFileSync(join(repoRoot, ".env"), "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // DATABASE_URL must be set in the environment when .env is absent.
  }
}

loadEnvFile();

// Test defaults when .env is absent (fresh worktrees).
process.env.UNSUBSCRIBE_TOKEN_SECRET ??= "dev-unsubscribe-token-secret";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";

import { db, tables, client } from "../packages/db/src/index.ts";
import { getBoss, stopBoss } from "../packages/queue/src/boss.ts";

type TestMode = "happy-path" | "permanent-failure" | "outer-rollback" | "suppression-during-run";

interface Args {
  workspaces: number;
  enrollments: number;
  workers: number;
  duration: number;
  testMode: TestMode;
}

function parseArgs(): Args {
  const defaults: Args = {
    workspaces: 3,
    enrollments: 100,
    workers: 2,
    duration: 120,
    testMode: "happy-path",
  };
  const out = { ...defaults };
  for (const arg of process.argv.slice(2)) {
    const [key, raw] = arg.replace(/^--/, "").split("=");
    if (!key) continue;
    if (key === "test-mode" && raw) {
      out.testMode = raw as TestMode;
      continue;
    }
    const value = Number(raw);
    if (Number.isNaN(value)) continue;
    if (key === "workspaces") out.workspaces = value;
    if (key === "enrollments") out.enrollments = value;
    if (key === "workers") out.workers = value;
    if (key === "duration") out.duration = value;
  }

  if (out.testMode !== "happy-path") {
    out.workspaces = 1;
    out.enrollments = Math.min(out.enrollments, 5);
    out.workers = 1;
    out.duration = Math.min(out.duration, 30);
  }

  return out;
}

function makeId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

const WIDE_WINDOW = {
  timezone: "UTC",
  window: {
    sun: [[0, 24]],
    mon: [[0, 24]],
    tue: [[0, 24]],
    wed: [[0, 24]],
    thu: [[0, 24]],
    fri: [[0, 24]],
    sat: [[0, 24]],
  },
};

interface SeedResult {
  orgId: string;
  enrollmentIds: string[];
  prospectEmails: string[];
}

async function seedWorkspace(label: string, enrollmentCount: number): Promise<SeedResult> {
  const orgId = makeId("org");
  const userId = makeId("user");
  const memberId = makeId("member");
  const now = new Date();
  const enrollmentIds: string[] = [];
  const prospectEmails: string[] = [];

  await db.insert(tables.user).values({
    id: userId,
    name: `${label} User`,
    email: `${label}-${randomUUID().slice(0, 8)}@loadtest.quiksend.local`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(tables.organization).values({
    id: orgId,
    name: `${label} Workspace`,
    slug: `${label}-${randomUUID().slice(0, 8)}`,
    metadata: JSON.stringify({ postal_address: "100 Test Ave, Load City, CA 94000" }),
    createdAt: now,
  });

  await db.insert(tables.member).values({
    id: memberId,
    organizationId: orgId,
    userId,
    role: "owner",
    createdAt: now,
  });

  const [mailbox] = await db
    .insert(tables.mailbox)
    .values({
      organizationId: orgId,
      ownerUserId: userId,
      provider: "smtp",
      address: `${label}@loadtest.quiksend.local`,
      dailyCap: 50,
      throttleSeconds: 0,
      sendWindow: WIDE_WINDOW,
      status: "active",
    })
    .returning();
  if (!mailbox) throw new Error("Failed to create mailbox");

  const [sequence] = await db
    .insert(tables.sequence)
    .values({
      organizationId: orgId,
      name: `${label} Load Sequence`,
      status: "active",
      settings: {
        timezone: "UTC",
        throttle_seconds: 0,
        mailbox_ids: [mailbox.id],
        stop_on_reply: false,
        business_days_only: false,
      },
      createdByUserId: userId,
    })
    .returning();
  if (!sequence) throw new Error("Failed to create sequence");

  const stepConfigs = [
    {
      stepIndex: 0,
      stepType: "auto_email" as const,
      delayMinutes: 0,
      config: {
        subject: "Hello {{first_name}}",
        body_template: "<p>First touch for {{email}}</p>",
        ai_generate: false,
      },
    },
    {
      stepIndex: 1,
      stepType: "auto_email" as const,
      delayMinutes: 0,
      config: {
        subject: "Re: Hello {{first_name}}",
        body_template: "<p>Follow-up for {{email}}</p>",
        ai_generate: false,
      },
    },
  ];

  const steps = [];
  for (const step of stepConfigs) {
    const [row] = await db
      .insert(tables.sequenceStep)
      .values({
        sequenceId: sequence.id,
        organizationId: orgId,
        stepIndex: step.stepIndex,
        stepType: step.stepType,
        delayMinutes: step.delayMinutes,
        businessDaysOnly: false,
        config: step.config,
      })
      .returning();
    if (row) steps.push(row);
  }

  for (let i = 0; i < enrollmentCount; i++) {
    const [prospect] = await db
      .insert(tables.prospect)
      .values({
        organizationId: orgId,
        email: `${label}-prospect-${i}-${randomUUID().slice(0, 6)}@loadtest.local`,
        firstName: "Load",
        lastName: `Test${i}`,
        status: "active",
        source: "api",
      })
      .returning();
    if (!prospect) continue;

    prospectEmails.push(prospect.email);

    const anchorMessageId = `<anchor-${randomUUID()}@loadtest.local>`;
    const sentAt = new Date(now.getTime() - 60_000);

    const [anchorMessage] = await db
      .insert(tables.message)
      .values({
        organizationId: orgId,
        mailboxId: mailbox.id,
        prospectId: prospect.id,
        direction: "outbound",
        subject: "Manual anchor",
        bodyHtml: "<p>anchor</p>",
        bodyText: "anchor",
        messageIdHeader: anchorMessageId,
        providerMessageId: randomUUID(),
        providerThreadId: `thread-${randomUUID()}`,
        status: "sent",
        sentAt,
      })
      .returning();
    if (!anchorMessage) continue;

    const [enrollment] = await db
      .insert(tables.enrollment)
      .values({
        organizationId: orgId,
        sequenceId: sequence.id,
        prospectId: prospect.id,
        mailboxId: mailbox.id,
        state: "active",
        currentStepIndex: 0,
        nextRunAt: new Date(now.getTime() - 1000),
        anchorMessageId,
        anchorThreadId: anchorMessage.providerThreadId,
        createdByUserId: userId,
      })
      .returning();
    if (enrollment) enrollmentIds.push(enrollment.id);
  }

  return { orgId, enrollmentIds, prospectEmails };
}

async function resetQueue(): Promise<void> {
  const boss = await getBoss();
  await boss.deleteAllJobs("sequence.step");
  await boss.deleteAllJobs("sequence.tick");
}

async function seedAll(workspaces: number, enrollments: number): Promise<{ seeds: SeedResult[] }> {
  await resetQueue();
  await client`
    truncate table job_log, send_reservation, task, enrollment, sequence_step, sequence, message, mailbox, prospect, suppression restart identity cascade
  `;
  const perWorkspace = Math.ceil(enrollments / workspaces);
  const seeds: SeedResult[] = [];
  for (let w = 0; w < workspaces; w++) {
    const count =
      w === workspaces - 1 ? enrollments - perWorkspace * (workspaces - 1) : perWorkspace;
    seeds.push(await seedWorkspace(`ws${w}`, count));
  }
  return { seeds };
}

function workerEnv(testMode: TestMode): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = {
    ...process.env,
    QUIKSEND_ENGINE_FAKE_MAIL: "1",
    NODE_ENV: "test",
    UNSUBSCRIBE_TOKEN_SECRET:
      process.env.UNSUBSCRIBE_TOKEN_SECRET ?? "dev-unsubscribe-token-secret",
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  };

  if (testMode === "permanent-failure") {
    base.QUIKSEND_ENGINE_TEST_MODE = "permanent-failure";
  }
  if (testMode === "outer-rollback") {
    base.QUIKSEND_ENGINE_FORCE_OUTER_ROLLBACK = "1";
  }

  return base;
}

function spawnWorkers(count: number, testMode: TestMode): ChildProcess[] {
  const workerDir = join(repoRoot, "apps/worker");
  const children: ChildProcess[] = [];
  for (let i = 0; i < count; i++) {
    const child = spawn(
      "pnpm",
      ["exec", "dotenv", "-e", "../../.env", "--", "tsx", "src/index.ts"],
      {
        cwd: workerDir,
        env: workerEnv(testMode),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child.on("exit", (code, signal) => {
      if (code !== 0 && code !== null) {
        process.stderr.write(`[worker ${i}] exited code=${code} signal=${signal}\n`);
      }
    });
    children.push(child);
  }
  return children;
}

async function stopWorkers(children: ChildProcess[]): Promise<void> {
  for (const child of children) {
    child.kill("SIGTERM");
  }
  await Promise.all(
    children.map(
      (child) =>
        new Promise<void>((resolve) => {
          child.on("exit", () => resolve());
          setTimeout(() => {
            child.kill("SIGKILL");
            resolve();
          }, 5000);
        }),
    ),
  );
}

async function drainQueue(tickFn: () => Promise<void>, maxMs: number): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    await tickFn().catch(() => undefined);
    const pending = await client<{ count: number }[]>`
      select count(*)::int as count from pgboss.job
      where name = 'sequence.step' and state in ('created', 'retry', 'active')
    `;
    const activeStuck = await client<{ count: number }[]>`
      select count(*)::int as count from enrollment e
      join prospect p on p.id = e.prospect_id
      where p.email like '%@loadtest.local'
        and e.state = 'active'
        and e.next_run_at is null
        and e.current_step_index > 0
    `;
    const jobsLeft = pending[0]?.count ?? 0;
    const stuck = activeStuck[0]?.count ?? 0;
    if (jobsLeft === 0 && stuck === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

async function assertHappyPathInvariants(): Promise<string[]> {
  const violations: string[] = [];

  const dupKeys = await client<{ idempotency_key: string; count: string }[]>`
    select m.idempotency_key, count(*)::text as count
    from message m
    join prospect p on p.id = m.prospect_id
    where m.idempotency_key is not null
      and p.email like '%@loadtest.local'
    group by m.idempotency_key
    having count(*) > 1
  `;
  if (dupKeys.length > 0) {
    violations.push(`duplicate idempotency_key rows: ${dupKeys.length}`);
  }

  const capBreaches = await client<{ mailbox_id: string; cnt: string }[]>`
    select sr.mailbox_id, count(*)::text as cnt
    from send_reservation sr
    join mailbox m on m.id = sr.mailbox_id
    where sr.status in ('held', 'sent')
      and sr.reserved_at > now() - interval '24 hours'
      and m.address like '%@loadtest.quiksend.local'
    group by sr.mailbox_id, m.daily_cap
    having count(*) > m.daily_cap
  `;
  if (capBreaches.length > 0) {
    violations.push(`mailbox cap breaches: ${capBreaches.length}`);
  }

  const badEnrollments = await client<{ id: string }[]>`
    select e.id from enrollment e
    join prospect p on p.id = e.prospect_id
    where e.state in ('active', 'waiting', 'waiting_manual')
      and e.next_run_at is null
      and p.email like '%@loadtest.local'
  `;
  if (badEnrollments.length > 0) {
    violations.push(`enrollments neither terminal nor scheduled: ${badEnrollments.length}`);
  }

  const deadJobs = await client<{ count: string }[]>`
    select count(*)::text as count from job_log where status = 'dead'
  `;
  const deadCount = Number(deadJobs[0]?.count ?? 0);
  if (deadCount > 0) {
    violations.push(`unexpected dead job_log rows: ${deadCount}`);
  }

  return violations;
}

async function assertPermanentFailureInvariants(): Promise<string[]> {
  const violations: string[] = [];

  const failed = await client<{ count: string }[]>`
    select count(*)::text as count from enrollment e
    join prospect p on p.id = e.prospect_id
    where p.email like '%@loadtest.local' and e.state = 'failed'
  `;
  if (Number(failed[0]?.count ?? 0) === 0) {
    violations.push("expected enrollments in state=failed");
  }

  const deadJobs = await client<{ count: string }[]>`
    select count(*)::text as count from job_log where status = 'dead'
  `;
  if (Number(deadJobs[0]?.count ?? 0) === 0) {
    violations.push("expected job_log rows with status=dead");
  }

  return violations;
}

async function assertOuterRollbackInvariants(): Promise<string[]> {
  const violations: string[] = [];

  const dupKeys = await client<{ idempotency_key: string; count: string }[]>`
    select m.idempotency_key, count(*)::text as count
    from message m
    join prospect p on p.id = m.prospect_id
    where m.idempotency_key is not null
      and p.email like '%@loadtest.local'
      and m.status = 'sent'
    group by m.idempotency_key
    having count(*) > 1
  `;
  if (dupKeys.length > 0) {
    violations.push(`double-send after forced rollback: ${dupKeys.length} duplicate keys`);
  }

  return violations;
}

async function assertSuppressionMidRunInvariants(targetEnrollmentId: string): Promise<string[]> {
  const violations: string[] = [];

  const row = await client<{ state: string; outbound_count: string }[]>`
    select e.state, (
      select count(*)::text from message m
      where m.enrollment_id = e.id and m.direction = 'outbound' and m.status = 'sent'
    ) as outbound_count
    from enrollment e
    where e.id = ${targetEnrollmentId}
  `;

  const state = row[0]?.state;
  const outboundCount = Number(row[0]?.outbound_count ?? 0);

  if (state !== "stopped" && outboundCount > 1) {
    violations.push(
      `suppressed enrollment should not send follow-ups (state=${state}, sent=${outboundCount})`,
    );
  }

  return violations;
}

async function main(): Promise<void> {
  const args = parseArgs();
  console.log("Load test starting", args);

  const { seeds } = await seedAll(args.workspaces, args.enrollments);

  const { tick } = await import("../apps/worker/src/sequence/tick.ts");

  let suppressionTimer: ReturnType<typeof setTimeout> | null = null;
  let suppressionTargetEnrollmentId: string | null = null;

  if (args.testMode === "suppression-during-run" && seeds[0]?.enrollmentIds[0]) {
    suppressionTargetEnrollmentId = seeds[0].enrollmentIds[0];
    const orgId = seeds[0].orgId;
    const email = seeds[0].prospectEmails[0];
    suppressionTimer = setTimeout(() => {
      void db
        .insert(tables.suppression)
        .values({
          organizationId: orgId,
          value: email!.toLowerCase(),
          valueType: "email",
          reason: "manual",
        })
        .onConflictDoNothing()
        .then(() => console.log("Inserted mid-run suppression for", email))
        .catch((err: unknown) => {
          process.stderr.write(
            `suppression insert failed: ${err instanceof Error ? err.message : String(err)}\n`,
          );
        });
    }, 5000);
  }

  const tickTimer = setInterval(() => {
    void tick().catch((err: unknown) => {
      process.stderr.write(`tick error: ${err instanceof Error ? err.message : String(err)}\n`);
    });
  }, 10_000);
  await tick().catch(() => undefined);

  const workers = spawnWorkers(args.workers, args.testMode);
  console.log(`Spawned ${workers.length} worker processes`);

  await new Promise((resolve) => setTimeout(resolve, args.duration * 1000));

  await drainQueue(tick, args.testMode === "happy-path" ? 90_000 : 45_000);

  await stopWorkers(workers);
  clearInterval(tickTimer);
  if (suppressionTimer) clearTimeout(suppressionTimer);

  await new Promise((resolve) => setTimeout(resolve, 5000));

  await stopBoss().catch(() => undefined);

  let violations: string[] = [];
  switch (args.testMode) {
    case "permanent-failure":
      violations = await assertPermanentFailureInvariants();
      break;
    case "outer-rollback":
      violations = await assertOuterRollbackInvariants();
      break;
    case "suppression-during-run":
      if (suppressionTargetEnrollmentId) {
        violations = await assertSuppressionMidRunInvariants(suppressionTargetEnrollmentId);
      } else {
        violations.push("no enrollment to test suppression");
      }
      break;
    default:
      violations = await assertHappyPathInvariants();
  }

  await client.end();

  if (violations.length > 0) {
    console.error("FAIL", violations);
    process.exit(1);
  }

  console.log(`OK — ${args.testMode} invariants passed`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

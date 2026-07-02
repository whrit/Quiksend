#!/usr/bin/env tsx
/**
 * Phase 6 engine load test — seeds enrollments, runs concurrent workers, asserts invariants.
 *
 * Usage:
 *   pnpm --filter @quiksend/worker exec dotenv -e ../../.env -- tsx ../../scripts/load-test-engine.ts --workspaces=3 --enrollments=100 --workers=2 --duration=120
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

import { db, tables, client } from "../packages/db/src/index.ts";
import { getBoss, stopBoss } from "../packages/queue/src/boss.ts";

interface Args {
  workspaces: number;
  enrollments: number;
  workers: number;
  duration: number;
}

function parseArgs(): Args {
  const defaults = { workspaces: 3, enrollments: 100, workers: 2, duration: 120 };
  const out = { ...defaults };
  for (const arg of process.argv.slice(2)) {
    const [key, raw] = arg.replace(/^--/, "").split("=");
    const value = Number(raw);
    if (!key || Number.isNaN(value)) continue;
    if (key === "workspaces") out.workspaces = value;
    if (key === "enrollments") out.enrollments = value;
    if (key === "workers") out.workers = value;
    if (key === "duration") out.duration = value;
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

async function seedWorkspace(label: string, enrollmentCount: number): Promise<void> {
  const orgId = makeId("org");
  const userId = makeId("user");
  const memberId = makeId("member");
  const now = new Date();

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

    await db.insert(tables.enrollment).values({
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
    });
  }
}

async function resetQueue(): Promise<void> {
  const boss = await getBoss();
  // On a fresh CI database queues don't exist yet; ignore that specific error.
  for (const queue of ["sequence.step", "sequence.tick"]) {
    try {
      await boss.deleteAllJobs(queue);
    } catch (err) {
      if (err instanceof Error && /does not exist/i.test(err.message)) continue;
      throw err;
    }
  }
}

async function seedAll(workspaces: number, enrollments: number): Promise<void> {
  await resetQueue();
  await client`
    truncate table job_log, send_reservation, task, enrollment, sequence_step, sequence, message, mailbox, prospect restart identity cascade
  `;
  const perWorkspace = Math.ceil(enrollments / workspaces);
  for (let w = 0; w < workspaces; w++) {
    const count =
      w === workspaces - 1 ? enrollments - perWorkspace * (workspaces - 1) : perWorkspace;
    await seedWorkspace(`ws${w}`, count);
  }
}

function spawnWorkers(count: number): ChildProcess[] {
  const workerDir = join(repoRoot, "apps/worker");
  const children: ChildProcess[] = [];
  for (let i = 0; i < count; i++) {
    const child = spawn(
      "pnpm",
      ["exec", "dotenv", "-e", "../../.env", "--", "tsx", "src/index.ts"],
      {
        cwd: workerDir,
        env: {
          ...process.env,
          QUIKSEND_ENGINE_FAKE_MAIL: "1",
          NODE_ENV: "test",
        },
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

async function assertInvariants(): Promise<string[]> {
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

async function main(): Promise<void> {
  const args = parseArgs();
  console.log("Load test starting", args);

  await seedAll(args.workspaces, args.enrollments);

  const { tick } = await import("../apps/worker/src/sequence/tick.ts");
  const tickTimer = setInterval(() => {
    void tick().catch((err: unknown) => {
      process.stderr.write(`tick error: ${err instanceof Error ? err.message : String(err)}\n`);
    });
  }, 10_000);
  await tick().catch(() => undefined);

  const workers = spawnWorkers(args.workers);
  console.log(`Spawned ${workers.length} worker processes`);

  await new Promise((resolve) => setTimeout(resolve, args.duration * 1000));

  await drainQueue(tick, 90_000);

  await stopWorkers(workers);
  clearInterval(tickTimer);

  // Final grace for in-flight handlers.
  await new Promise((resolve) => setTimeout(resolve, 5000));

  await stopBoss().catch(() => undefined);

  const violations = await assertInvariants();
  await client.end();

  if (violations.length > 0) {
    console.error("FAIL", violations);
    process.exit(1);
  }

  console.log(
    "OK — no duplicate idempotency_keys, no cap breaches, enrollments valid, no dead jobs",
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

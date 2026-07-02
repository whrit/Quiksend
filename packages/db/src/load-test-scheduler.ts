#!/usr/bin/env tsx
/**
 * Scheduler load test — seeds workspaces + enrollments, runs concurrent workers,
 * asserts no double-send, cap overshoot, or crashes.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { env, logger } from "@quiksend/config";
import { eq } from "drizzle-orm";
import { client, db } from "./client.ts";
import { member, organization, user } from "./schema/auth.ts";
import * as tables from "./schema/index.ts";

const repoRoot = join(fileURLToPath(import.meta.url), "..", "..", "..");

const { values } = parseArgs({
  options: {
    workspaces: { type: "string", default: "3" },
    enrollments: { type: "string", default: "100" },
    workers: { type: "string", default: "2" },
    duration: { type: "string", default: "60" },
  },
});

const workspaceCount = Number(values.workspaces);
const enrollmentsPerWorkspace = Number(values.enrollments);
const workerCount = Number(values.workers);
const durationSec = Number(values.duration);

function makeId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

async function seedWorkspace(label: string) {
  const orgId = makeId("org");
  const userId = makeId("user");
  const memberId = makeId("member");
  const now = new Date();

  await db.insert(user).values({
    id: userId,
    name: `${label} User`,
    email: `${label}-${randomUUID().slice(0, 8)}@loadtest.quiksend.local`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(organization).values({
    id: orgId,
    name: `${label} Workspace`,
    slug: `${label}-${randomUUID().slice(0, 8)}`,
    createdAt: now,
  });

  await db.insert(member).values({
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
      address: `${label}@loadtest.local`,
      dailyCap: 500,
      throttleSeconds: 0,
      status: "active",
    })
    .returning();

  const [sequence] = await db
    .insert(tables.sequence)
    .values({
      organizationId: orgId,
      name: `${label} Sequence`,
      status: "active",
      settings: {
        timezone: "UTC",
        throttle_seconds: 0,
        mailbox_ids: mailbox ? [mailbox.id] : [],
        stop_on_reply: true,
        business_days_only: false,
      },
      createdByUserId: userId,
    })
    .returning();

  if (!mailbox || !sequence) throw new Error("Failed to seed mailbox/sequence");

  await db.insert(tables.sequenceStep).values({
    sequenceId: sequence.id,
    organizationId: orgId,
    stepIndex: 0,
    stepType: "wait",
    delayMinutes: 0,
    businessDaysOnly: false,
    config: { minutes: 0 },
  });

  const prospectIds: string[] = [];
  for (let i = 0; i < enrollmentsPerWorkspace; i++) {
    const [prospect] = await db
      .insert(tables.prospect)
      .values({
        organizationId: orgId,
        email: `${label}-p${i}@loadtest.local`,
        firstName: "Load",
        lastName: `Test ${i}`,
        source: "manual",
      })
      .returning({ id: tables.prospect.id });
    if (prospect) prospectIds.push(prospect.id);
  }

  const anchor = new Date();
  for (const prospectId of prospectIds) {
    await db.insert(tables.enrollment).values({
      organizationId: orgId,
      sequenceId: sequence.id,
      prospectId,
      mailboxId: mailbox.id,
      state: "active",
      currentStepIndex: 0,
      nextRunAt: anchor,
      createdByUserId: userId,
    });
  }

  return { orgId, mailboxId: mailbox.id, dailyCap: mailbox.dailyCap };
}

function startWorker(): ChildProcess {
  return spawn("pnpm", ["--filter", "@quiksend/worker", "dev"], {
    cwd: repoRoot,
    env: { ...process.env, NODE_ENV: "test" },
    stdio: "pipe",
  });
}

async function assertInvariants(orgIds: string[]): Promise<void> {
  for (const orgId of orgIds) {
    const dupes = await client<{ count: string }[]>`
      select count(*)::text as count from (
        select idempotency_key from message
        where organization_id = ${orgId} and idempotency_key is not null
        group by idempotency_key having count(*) > 1
      ) t
    `;
    if (Number(dupes[0]?.count ?? 0) > 0) {
      throw new Error(`Double-send detected for org ${orgId}`);
    }

    const mailboxes = await db
      .select()
      .from(tables.mailbox)
      .where(eq(tables.mailbox.organizationId, orgId));

    for (const mailbox of mailboxes) {
      const sentToday = await client<{ count: string }[]>`
        select count(*)::text as count from message
        where organization_id = ${orgId}
          and mailbox_id = ${mailbox.id}
          and direction = 'outbound'
          and sent_at >= date_trunc('day', now())
      `;
      if (Number(sentToday[0]?.count ?? 0) > mailbox.dailyCap) {
        throw new Error(`Daily cap breached for mailbox ${mailbox.id}`);
      }
    }
  }
}

async function main(): Promise<void> {
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL required");

  logger.info(
    { workspaceCount, enrollmentsPerWorkspace, workerCount, durationSec },
    "Load test starting",
  );

  const orgIds: string[] = [];
  for (let i = 0; i < workspaceCount; i++) {
    const ws = await seedWorkspace(`load-${i + 1}`);
    orgIds.push(ws.orgId);
  }

  const workers = Array.from({ length: workerCount }, () => startWorker());
  let crashed = false;
  for (const w of workers) {
    w.on("exit", (code) => {
      if (code !== 0 && code !== null) crashed = true;
    });
  }

  await new Promise((resolve) => setTimeout(resolve, durationSec * 1000));

  for (const w of workers) w.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 2000));

  if (crashed) throw new Error("One or more workers crashed");

  await assertInvariants(orgIds);
  logger.info("Load test passed: zero double-sends, zero cap breaches, zero crashes.");
}

main()
  .catch((err) => {
    logger.error({ err }, "Load test failed");
    process.exit(1);
  })
  .finally(async () => {
    await client.end();
  });

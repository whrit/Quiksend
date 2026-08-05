import { env, logger } from "@quiksend/config";
import { client, db } from "@quiksend/db";
import { initSentry, Sentry, shutdownPostHog } from "@quiksend/observability";
import { enqueue, getBoss, registerHandler, stopBoss } from "@quiksend/queue";
import { sql } from "drizzle-orm";
import { writeFileSync, unlinkSync } from "fs";
import { registerAiResearchHandler } from "./handlers/ai-research.ts";
import {
  registerGatewayDetectHandlers,
  registerGatewaySweepCron,
} from "./handlers/gateway-detect.ts";
import { registerImportProspectsHandler } from "./handlers/import-prospects.ts";
import { registerCrmSyncHandler } from "./handlers/crm-sync.ts";
import { registerWebhookFanoutHandler } from "./handlers/webhook-fanout.ts";
import { registerCrmWritebackHandler } from "./handlers/crm-writeback.ts";
import { registerMailboxPollHandler, registerMailboxPollTick } from "./handlers/mailbox-poll.ts";
import { registerNangoWebhookSweep } from "./handlers/nango-webhook-sweep.ts";
import { registerOutboxDispatchHandler } from "./handlers/outbox-dispatch.ts";
import { registerSequenceHandlers } from "./sequence/register.ts";
import { registerCanaryCheckHandler } from "./handlers/canary-check.ts";
import { registerCanaryRecoverHandler } from "./handlers/canary-recover.ts";
import { registerCanarySendHandler } from "./handlers/canary-send-handler.ts";
import { registerDeliverabilitySnapshotHandler } from "./handlers/deliverability-snapshot.ts";
import { registerSeedInboxVerifyHandler } from "./handlers/seed-inbox-verify.ts";
import { registerSeedPoolHealthHandler } from "./handlers/seed-pool-health.ts";
import { registerSeedPoolLegitMailHandler } from "./handlers/seed-pool-legit-mail.ts";
import { registerMailTransactionalSendHandler } from "./handlers/mail-transactional-send.ts";
import { registerHealthReconcileHandler } from "./handlers/health-reconcile.ts";
import { registerRetentionPurgeHandler } from "./handlers/retention-purge.ts";
import { registerOperationalSnapshotHandler, shutdownOperationalSnapshot } from "./operational-snapshot.ts";

/**
 * Worker entrypoint. Boots pg-boss, registers job handlers, and idles waiting
 * for jobs. Real handlers arrive across Phases 3–8; today only `hello.ping`
 * runs, proving the plumbing end-to-end.
 *
 * Sentry is best-effort — no-op when SENTRY_DSN is unset.
 */
let heartbeatInterval: NodeJS.Timeout | undefined;

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "Worker shutting down");
  
  // Clear heartbeat timer
  clearInterval(heartbeatInterval);
  
  // Remove heartbeat file
  try {
    unlinkSync("/tmp/worker-ready");
  } catch {
    // File may not exist, ignore error
  }
  
  try {
    shutdownOperationalSnapshot();
    await stopBoss();
    await shutdownPostHog();
    await client.end();
    await Sentry.close(2000);
  } catch (err) {
    logger.error({ err }, "Error during shutdown");
  }
  process.exit(0);
}

async function main(): Promise<void> {
  initSentry("quiksend-worker");
  logger.info({ env: env.NODE_ENV }, "Quiksend worker starting");

  await db.execute(sql`select 1`);
  logger.info("Database connection OK");

  // Boot pg-boss (schema install + start).
  await getBoss();

  // Foundations smoke test: register a handler + enqueue one job.
  // Real handlers (sequence.tick, sequence.step, mailbox.poll, crm.sync, ...) land per phase.
  await registerHandler("hello.ping", async ({ message }) => {
    logger.info({ message }, "hello.ping handled");
  });

  await registerCrmSyncHandler();
  await registerWebhookFanoutHandler();
  await registerCrmWritebackHandler();
  await registerAiResearchHandler();
  await registerImportProspectsHandler();
  await registerGatewayDetectHandlers();
  await registerGatewaySweepCron();
  await registerSequenceHandlers();
  await registerMailboxPollHandler();
  await registerSeedInboxVerifyHandler();
  await registerSeedPoolHealthHandler();
  await registerSeedPoolLegitMailHandler();
  await registerCanarySendHandler();
  await registerCanaryCheckHandler();
  await registerCanaryRecoverHandler();
  await registerDeliverabilitySnapshotHandler();
  await registerMailboxPollTick();
  await registerNangoWebhookSweep();
  await registerMailTransactionalSendHandler();
  await registerOutboxDispatchHandler();

  // Initialize production heartbeat: write /tmp/worker-ready mtime every 30s
  // Healthcheck uses stat to detect stale heartbeat (>90s)
  heartbeatInterval = setInterval(() => {
    try {
      writeFileSync("/tmp/worker-ready", "");
    } catch (err) {
      logger.error({ err }, "Failed to write heartbeat file");
    }
  }, 30_000);
  
  // Write initial heartbeat file (all initialization complete)
  await registerHealthReconcileHandler();
  await registerOperationalSnapshotHandler();
  await registerRetentionPurgeHandler();
  try {
    writeFileSync("/tmp/worker-ready", "");
  } catch (err) {
    logger.error({ err }, "Failed to write initial heartbeat file");
  }

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err: unknown) => {
  logger.error({ err }, "Worker failed to start");
  Sentry.captureException(err);
  process.exit(1);
});

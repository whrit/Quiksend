import { createFileRoute } from "@tanstack/react-router";
import { db } from "@quiksend/db";
import { sql } from "drizzle-orm";
import { logger } from "@quiksend/config";
import { probeDatabase, probeQueue } from "../health.helpers";

/**
 * Readiness probe: 200 if all critical dependencies are healthy, 503 otherwise.
 * Probes:
 * - Database: SELECT NOW() with 3s timeout
 * - Queue: getQueueSize with 2s timeout (tests actual DB connectivity)
 *
 * Does NOT leak internal error details. Errors are logged but response is generic.
 * Total probe time bounded to 5 seconds.
 */
export const Route = createFileRoute("/api/health/ready")({
  server: {
    handlers: {
      GET: async () => {
        const startTime = Date.now();
        try {
          const dbProbeMs = await probeDatabase(
            {
              execute: async () => {
                await db.execute(sql`SELECT NOW()`);
              },
            },
            3000,
          );
          const queueProbeMs = await probeQueue(2000);

          return Response.json(
            {
              status: "ready",
              timestamp: new Date().toISOString(),
              db_probe_ms: dbProbeMs,
              queue_probe_ms: queueProbeMs,
              elapsed_ms: Date.now() - startTime,
            },
            { status: 200 },
          );
        } catch (err) {
          logger.warn({ err }, "Readiness probe failed");
          return Response.json(
            { status: "not_ready", message: "Service unavailable" },
            { status: 503 },
          );
        }
      },
    },
  },
});

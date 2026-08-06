import { db, recordAudit } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { enqueue } from "@quiksend/queue";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { withOwnerReauth } from "../../../lib/api/v1/lifecycle-auth.ts";
import { jsonData, jsonError, parseJsonBody } from "../../../lib/api/v1/middleware.ts";

/**
 * Organization deletion (Task 5). Owner role + fresh password
 * reauthentication (see `withOwnerReauth`) are required. On success this:
 *   1. marks the organization for deletion and disables sending IMMEDIATELY
 *      (`organizationLifecycle.sendingDisabledAt`, checked by every send
 *      path via `isSendSuppressed`);
 *   2. records an audit row;
 *   3. enqueues the nightly bounded, resumable retention purge.
 *
 * Customer content (messages) is retained for the documented compliance
 * window before the purge job deletes it — see `retention-purge.ts`.
 * Suppression rows and the audit trail are never touched by this endpoint
 * or by the purge job.
 */

const bodySchema = z.object({ password: z.string().min(1) });

export const Route = createFileRoute("/api/v1/organization-delete")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const parsed = bodySchema.safeParse(await parseJsonBody<unknown>(request));
        if (!parsed.success) {
          return jsonError("INVALID_BODY", "A current password is required", 400);
        }

        return withOwnerReauth(request, parsed.data.password, async (ctx) => {
          const now = new Date();

          await db
            .insert(tables.organizationLifecycle)
            .values({
              organizationId: ctx.organizationId,
              deletionRequestedAt: now,
              deletionRequestedByUserId: ctx.userId,
              sendingDisabledAt: now,
            })
            .onConflictDoUpdate({
              target: tables.organizationLifecycle.organizationId,
              set: {
                deletionRequestedAt: now,
                deletionRequestedByUserId: ctx.userId,
                sendingDisabledAt: now,
              },
            });

          await recordAudit({
            organizationId: ctx.organizationId,
            actorType: "user",
            actorId: ctx.userId,
            action: "organization.delete_requested",
            entityType: "organization",
            entityId: ctx.organizationId,
          });

          await enqueue("retention.purge", {});

          return jsonData({
            status: "deletion_scheduled",
            sendingDisabled: true,
            deletionRequestedAt: now.toISOString(),
          });
        });
      },
    },
  },
});

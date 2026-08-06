import { createHash } from "node:crypto";
import { logger } from "@quiksend/config";
import { db, insertOutbox } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { getProviderConfig, verifyNangoWebhook } from "@quiksend/integrations";
import type { CrmProvider } from "@quiksend/integrations/providers";
import { enqueue } from "@quiksend/queue";
import { createFileRoute } from "@tanstack/react-router";
import { eq } from "drizzle-orm";
import { z } from "zod";

const NANGO_DELIVERY_TIMESTAMP_HEADERS = [
  "X-Nango-Timestamp",
  "X-Nango-Delivery-Timestamp",
  "Date",
] as const;

/** Nango envelope fields with parseable delivery times (`from` is the literal "nango"). */
const NANGO_DELIVERY_TIMESTAMP_BODY_FIELDS = ["modifiedAfter", "failedAt", "startedAt"] as const;

const syncWebhookSchema = z.object({
  type: z.literal("sync"),
  connectionId: z.string(),
  providerConfigKey: z.string(),
  model: z.string(),
  success: z.boolean().optional(),
  syncName: z.string().optional(),
  modifiedAfter: z.string().optional(),
  event_id: z.string().optional(),
  eventId: z.string().optional(),
});

const authWebhookSchema = z.object({
  type: z.literal("auth"),
  connectionId: z.string(),
  providerConfigKey: z.string(),
  success: z.boolean(),
  /**
   * Present on failed auth webhooks — Nango carries e.g.
   * `error: { type: "invalid_credentials", description: "..." }` when a
   * refresh fails. UI uses this to distinguish reconnect-required from
   * other error states.
   */
  error: z
    .object({
      type: z.string(),
      description: z.string().optional(),
    })
    .optional(),
  /** Nango auth operation kind: creation, refresh, etc. */
  operation: z.string().optional(),
  event_id: z.string().optional(),
  eventId: z.string().optional(),
});

function resolveNangoDeliveryTimestampHeader(request: Request, rawBody: string): string | null {
  for (const name of NANGO_DELIVERY_TIMESTAMP_HEADERS) {
    const value = request.headers.get(name);
    if (value) return value;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const record = parsed as Record<string, unknown>;
  for (const field of NANGO_DELIVERY_TIMESTAMP_BODY_FIELDS) {
    const value = record[field];
    if (typeof value === "string" && value.length > 0) return value;
  }

  const from = record.from;
  if (typeof from === "string" && from.length > 0 && from !== "nango") {
    return from;
  }

  // Auth payloads only carry `from: "nango"` — no parseable delivery time in the body.
  if (record.type === "auth") {
    return String(Math.floor(Date.now() / 1000));
  }

  return null;
}

function resolveNangoEventId(input: {
  body: Record<string, unknown>;
  connectionId: string;
  type: "sync" | "auth";
  model?: string;
  modifiedAfter?: string;
  operation?: string;
  success?: boolean;
}): string {
  const explicit = input.body.event_id ?? input.body.eventId;
  if (typeof explicit === "string" && explicit.length > 0) return explicit;

  const key = [
    input.connectionId,
    input.type,
    input.model ?? "",
    input.modifiedAfter ?? "",
    input.operation ?? "",
    input.success === undefined ? "" : String(input.success),
  ].join("|");
  return createHash("sha256").update(key).digest("hex");
}

export const Route = createFileRoute("/api/nango/webhook")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const rawBody = await request.text();
        const signatureHeader = request.headers.get("X-Nango-Signature");
        const timestampHeader = resolveNangoDeliveryTimestampHeader(request, rawBody);

        if (!verifyNangoWebhook({ rawBody, signatureHeader, timestampHeader })) {
          logger.warn("Rejected Nango webhook with invalid signature");
          return new Response(JSON.stringify({ error: "invalid signature" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        let body: unknown;
        try {
          body = JSON.parse(rawBody) as unknown;
        } catch {
          return new Response(JSON.stringify({ error: "invalid json" }), { status: 400 });
        }

        const parsedSync = syncWebhookSchema.safeParse(body);
        if (parsedSync.success) {
          const payload = parsedSync.data;
          if (payload.success === false) {
            logger.warn({ payload }, "Nango sync webhook reported failure");
            return Response.json({ received: true });
          }

          const eventId = resolveNangoEventId({
            body: payload,
            connectionId: payload.connectionId,
            type: "sync",
            model: payload.model,
            modifiedAfter: payload.modifiedAfter,
          });

          const connection = await db.query.crmConnection.findFirst({
            where: eq(tables.crmConnection.nangoConnectionId, payload.connectionId),
          });

          if (!connection) {
            // No connection — still claim to prevent retries, but no outbox
            const [claimed] = await db
              .insert(tables.nangoWebhookProcessed)
              .values({ eventId, connectionId: payload.connectionId })
              .onConflictDoNothing()
              .returning({ eventId: tables.nangoWebhookProcessed.eventId });
            if (!claimed) {
              logger.info(
                { eventId, connectionId: payload.connectionId },
                "duplicate Nango sync webhook",
              );
              return Response.json({ duplicate: true });
            }
            logger.info(
              { connectionId: payload.connectionId },
              "Nango sync webhook for unknown connection",
            );
            return Response.json({ received: true });
          }

          const model =
            payload.model === "Company" || payload.model === "Account" ? payload.model : "Contact";

          // Claim + outbox in one tx: claim is not terminal until outbox commits
          const claimed = await db.transaction(async (tx) => {
            const [row] = await tx
              .insert(tables.nangoWebhookProcessed)
              .values({ eventId, connectionId: payload.connectionId })
              .onConflictDoNothing()
              .returning({ eventId: tables.nangoWebhookProcessed.eventId });
            if (!row) return false;

            await insertOutbox(tx, {
              organizationId: connection.organizationId,
              eventType: "crm.sync",
              aggregateType: "crm_connection",
              aggregateId: connection.id,
              payload: { connectionId: connection.id, model },
              idempotencyKey: eventId,
            });
            return true;
          });

          if (!claimed) {
            logger.info(
              { eventId, connectionId: payload.connectionId },
              "duplicate Nango sync webhook",
            );
            return Response.json({ duplicate: true });
          }

          // Best-effort enqueue — sweep recovers on failure
          try {
            await enqueue("outbox.dispatch", {});
          } catch {
            // ponytail: sweep recovers
          }

          logger.info(
            { organizationId: connection.organizationId, connectionId: connection.id, model },
            "nango sync outbox committed",
          );

          return Response.json({ received: true });
        }

        const parsedAuth = authWebhookSchema.safeParse(body);
        if (parsedAuth.success) {
          const payload = parsedAuth.data;
          const eventId = resolveNangoEventId({
            body: payload,
            connectionId: payload.connectionId,
            type: "auth",
            operation: payload.operation,
            success: payload.success,
          });

          const provider = payload.providerConfigKey as CrmProvider;
          const status: "active" | "error" | "disconnected" = payload.success ? "active" : "error";

          try {
            getProviderConfig(provider);
          } catch {
            return Response.json({ received: true });
          }

          // Claim + source mutation in one tx
          const claimed = await db.transaction(async (tx) => {
            const [row] = await tx
              .insert(tables.nangoWebhookProcessed)
              .values({ eventId, connectionId: payload.connectionId })
              .onConflictDoNothing()
              .returning({ eventId: tables.nangoWebhookProcessed.eventId });
            if (!row) return false;

            await tx
              .update(tables.crmConnection)
              .set({ status })
              .where(eq(tables.crmConnection.nangoConnectionId, payload.connectionId));
            return true;
          });

          if (!claimed) {
            logger.info(
              { eventId, connectionId: payload.connectionId },
              "duplicate Nango auth webhook",
            );
            return Response.json({ duplicate: true });
          }

          return Response.json({ received: true });
        }

        return Response.json({ received: true });
      },
    },
  },
});

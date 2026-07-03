import { createHash } from "node:crypto";
import { logger } from "@quiksend/config";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { getProviderConfig, verifyNangoWebhook } from "@quiksend/integrations";
import type { CrmProvider } from "@quiksend/integrations/providers";
import { enqueue } from "@quiksend/queue";
import { createFileRoute } from "@tanstack/react-router";
import { eq } from "drizzle-orm";
import { z } from "zod";

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
  event_id: z.string().optional(),
  eventId: z.string().optional(),
});

function extractNangoEventId(rawBody: string, body: Record<string, unknown>): string {
  const explicit = body.event_id ?? body.eventId;
  if (typeof explicit === "string" && explicit.length > 0) return explicit;
  return createHash("sha256").update(rawBody).digest("hex");
}

async function claimNangoWebhook(eventId: string, connectionId: string): Promise<boolean> {
  const [row] = await db
    .insert(tables.nangoWebhookProcessed)
    .values({ eventId, connectionId })
    .onConflictDoNothing()
    .returning({ eventId: tables.nangoWebhookProcessed.eventId });
  return row !== undefined;
}

export const Route = createFileRoute("/api/nango/webhook")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const rawBody = await request.text();
        const signatureHeader = request.headers.get("X-Nango-Signature");

        if (!verifyNangoWebhook({ rawBody, signatureHeader })) {
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

          const eventId = extractNangoEventId(rawBody, payload);
          const claimed = await claimNangoWebhook(eventId, payload.connectionId);
          if (!claimed) {
            logger.info(
              { eventId, connectionId: payload.connectionId },
              "duplicate Nango sync webhook",
            );
            return Response.json({ duplicate: true });
          }

          const connection = await db.query.crmConnection.findFirst({
            where: eq(tables.crmConnection.nangoConnectionId, payload.connectionId),
          });

          if (connection) {
            const organizationId = connection.organizationId;
            const model =
              payload.model === "Company" || payload.model === "Account"
                ? payload.model
                : "Contact";
            await enqueue("crm.sync", { connectionId: connection.id, model });
            logger.info(
              { organizationId, connectionId: connection.id, model },
              "enqueued crm.sync",
            );
          } else {
            logger.info(
              { connectionId: payload.connectionId },
              "Nango sync webhook for unknown connection",
            );
          }

          return Response.json({ received: true });
        }

        const parsedAuth = authWebhookSchema.safeParse(body);
        if (parsedAuth.success) {
          const payload = parsedAuth.data;
          const eventId = extractNangoEventId(rawBody, payload);
          const claimed = await claimNangoWebhook(eventId, payload.connectionId);
          if (!claimed) {
            logger.info(
              { eventId, connectionId: payload.connectionId },
              "duplicate Nango auth webhook",
            );
            return Response.json({ duplicate: true });
          }

          const provider = payload.providerConfigKey as CrmProvider;
          const status: "active" | "error" | "disconnected" = payload.success ? "active" : "error";

          try {
            getProviderConfig(provider);
          } catch {
            return Response.json({ received: true });
          }

          await db
            .update(tables.crmConnection)
            .set({ status })
            .where(eq(tables.crmConnection.nangoConnectionId, payload.connectionId));

          return Response.json({ received: true });
        }

        return Response.json({ received: true });
      },
    },
  },
});

import { logger } from "@quiksend/config";
import { db, tables } from "@quiksend/db";
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
});

const authWebhookSchema = z.object({
  type: z.literal("auth"),
  connectionId: z.string(),
  providerConfigKey: z.string(),
  success: z.boolean(),
});

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
          const provider = payload.providerConfigKey as CrmProvider;
          let status: "active" | "error" | "disconnected" = payload.success ? "active" : "error";

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

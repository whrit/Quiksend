import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { verifyUnsubscribeToken } from "@quiksend/mail";
import { enqueue } from "@quiksend/queue";
import { createFileRoute } from "@tanstack/react-router";
import { and, eq } from "drizzle-orm";
import { insertDomainEventAndFanout } from "@/lib/api/v1/helpers.ts";

async function enqueueCrmWriteback(organizationId: string, prospectId: string): Promise<void> {
  const prospect = await db.query.prospect.findFirst({
    where: and(
      eq(tables.prospect.id, prospectId),
      eq(tables.prospect.organizationId, organizationId),
    ),
  });
  if (!prospect?.crmConnectionId) return;

  await enqueue("crm.writeback", {
    connectionId: prospect.crmConnectionId,
    eventType: "status",
    entityId: prospectId,
    idempotencyKey: `unsubscribe:${prospectId}`,
  });
}

function confirmationHtml(message: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Unsubscribed</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 480px; margin: 48px auto; padding: 0 16px; color: #111; }
    p { line-height: 1.5; }
  </style>
</head>
<body>
  <h1>Unsubscribed</h1>
  <p>${message}</p>
</body>
</html>`;
}

export const Route = createFileRoute("/api/v1/unsubscribe")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const token = new URL(request.url).searchParams.get("token");
        if (!token) {
          return new Response(confirmationHtml("This unsubscribe link is invalid."), {
            status: 400,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }

        const payload = verifyUnsubscribeToken(token);
        if (!payload) {
          return new Response(
            confirmationHtml("This unsubscribe link is invalid or has expired."),
            {
              status: 400,
              headers: { "Content-Type": "text/html; charset=utf-8" },
            },
          );
        }

        const prospect = await db.query.prospect.findFirst({
          where: and(
            eq(tables.prospect.id, payload.prospectId),
            eq(tables.prospect.organizationId, payload.orgId),
          ),
        });

        if (!prospect) {
          return new Response(confirmationHtml("We could not find this subscription."), {
            status: 404,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }

        const existing = await db.query.suppression.findFirst({
          where: and(
            eq(tables.suppression.organizationId, payload.orgId),
            eq(tables.suppression.value, prospect.email),
            eq(tables.suppression.reason, "unsubscribe"),
          ),
        });

        if (!existing) {
          await db.insert(tables.suppression).values({
            organizationId: payload.orgId,
            value: prospect.email,
            valueType: "email",
            reason: "unsubscribe",
            notes: "One-click unsubscribe link",
          });

          await db
            .update(tables.prospect)
            .set({ status: "unsubscribed" })
            .where(
              and(
                eq(tables.prospect.id, payload.prospectId),
                eq(tables.prospect.organizationId, payload.orgId),
              ),
            );

          await enqueueCrmWriteback(payload.orgId, payload.prospectId);

          await insertDomainEventAndFanout({
            organizationId: payload.orgId,
            eventType: "prospect.unsubscribed",
            payload: {
              prospectId: payload.prospectId,
              email: prospect.email,
            },
          });
        }

        return new Response(
          confirmationHtml(
            "You have been unsubscribed. You will not receive further emails from this sender.",
          ),
          {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          },
        );
      },
    },
  },
});

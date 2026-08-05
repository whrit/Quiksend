import { randomUUID } from "node:crypto";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { verifyUnsubscribeToken } from "@quiksend/mail";
import { enqueue } from "@quiksend/queue";
import { createFileRoute } from "@tanstack/react-router";
import { and, eq } from "drizzle-orm";
import { insertDomainEventAndOutbox, tryDispatchOutbox } from "@/lib/api/v1/helpers.ts";
import { checkAuthIpRateLimit } from "@/lib/api/v1/middleware.ts";

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

function pageHtml(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 480px; margin: 48px auto; padding: 0 16px; color: #111; }
    p { line-height: 1.5; }
    button { font: inherit; padding: 10px 16px; cursor: pointer; }
  </style>
</head>
<body>
  ${body}
</body>
</html>`;
}

function confirmationHtml(message: string): string {
  return pageHtml("Unsubscribed", `<h1>Unsubscribed</h1><p>${message}</p>`);
}

function confirmationFormHtml(token: string): string {
  const action = `/api/v1/unsubscribe?token=${encodeURIComponent(token)}`;
  return pageHtml(
    "Confirm unsubscribe",
    `<h1>Unsubscribe</h1>
<p>Click below to confirm you no longer want to receive emails from this sender.</p>
<form method="POST" action="${action}">
  <button type="submit">Unsubscribe</button>
</form>`,
  );
}

type UnsubscribeOutcome =
  | { kind: "invalid_token" }
  | { kind: "success"; alreadySuppressed: boolean };

async function processUnsubscribe(token: string): Promise<UnsubscribeOutcome> {
  const payload = verifyUnsubscribeToken(token);
  if (!payload) return { kind: "invalid_token" };

  const prospect = await db.query.prospect.findFirst({
    where: and(
      eq(tables.prospect.id, payload.prospectId),
      eq(tables.prospect.organizationId, payload.orgId),
    ),
  });

  // Canary/seed sends may mint tokens with a sentinel prospect id — accept and no-op.
  if (!prospect) return { kind: "success", alreadySuppressed: true };

  const existing = await db.query.suppression.findFirst({
    where: and(
      eq(tables.suppression.organizationId, payload.orgId),
      eq(tables.suppression.value, prospect.email),
      eq(tables.suppression.reason, "unsubscribe"),
    ),
  });

  if (existing) return { kind: "success", alreadySuppressed: true };

  // Source mutations + domain event + outbox intent in one transaction
  await db.transaction(async (tx) => {
    await tx.insert(tables.suppression).values({
      organizationId: payload.orgId,
      value: prospect.email,
      valueType: "email",
      reason: "unsubscribe",
      notes: "One-click unsubscribe link",
    });

    await tx
      .update(tables.prospect)
      .set({ status: "unsubscribed" })
      .where(
        and(
          eq(tables.prospect.id, payload.prospectId),
          eq(tables.prospect.organizationId, payload.orgId),
        ),
      );

    await insertDomainEventAndOutbox(tx, {
      organizationId: payload.orgId,
      eventType: "prospect.unsubscribed",
      entityType: "prospect",
      entityId: payload.prospectId,
      payload: {
        prospectId: payload.prospectId,
        email: prospect.email,
      },
      idempotencyKey: `unsubscribe:${payload.prospectId}:${randomUUID()}`,
    });
  });

  await tryDispatchOutbox();
  await enqueueCrmWriteback(payload.orgId, payload.prospectId);

  return { kind: "success", alreadySuppressed: false };
}

function htmlResponse(message: string, status: number): Response {
  return new Response(confirmationHtml(message), {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

async function rateLimitedUnsubscribe(
  request: Request,
  handler: () => Promise<Response>,
): Promise<Response> {
  const outcome = await checkAuthIpRateLimit(request);
  if (!outcome.ok) {
    return new Response(JSON.stringify({ error: "rate_limited" }), {
      status: 429,
      headers: {
        "Retry-After": String(outcome.retryAfter),
        "Content-Type": "application/json",
      },
    });
  }
  return handler();
}

function extractToken(request: Request): string | null {
  return new URL(request.url).searchParams.get("token");
}

export const Route = createFileRoute("/api/v1/unsubscribe")({
  server: {
    handlers: {
      GET: ({ request }: { request: Request }) =>
        rateLimitedUnsubscribe(request, async () => {
          const token = extractToken(request);
          if (!token) {
            return htmlResponse("This unsubscribe link is invalid.", 400);
          }

          if (!verifyUnsubscribeToken(token)) {
            return htmlResponse("This unsubscribe link is invalid or has expired.", 400);
          }

          return new Response(confirmationFormHtml(token), {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }),

      POST: ({ request }: { request: Request }) =>
        rateLimitedUnsubscribe(request, async () => {
          const token = extractToken(request);
          if (!token) {
            return new Response(null, { status: 400 });
          }

          const contentType = request.headers.get("Content-Type") ?? "";
          const isFormEncoded = contentType.includes("application/x-www-form-urlencoded");
          const isMultipart = contentType.includes("multipart/form-data");
          if (!isFormEncoded && !isMultipart) {
            return new Response(null, { status: 400 });
          }

          let isRfc8058OneClick = false;
          if (isFormEncoded) {
            const body = await request.text();
            const params = new URLSearchParams(body);
            isRfc8058OneClick = params.get("List-Unsubscribe") === "One-Click";
          }

          const result = await processUnsubscribe(token);
          if (result.kind === "invalid_token") {
            return isRfc8058OneClick
              ? new Response(null, { status: 400 })
              : htmlResponse("This unsubscribe link is invalid or has expired.", 400);
          }

          if (isRfc8058OneClick) {
            // RFC 8058: mail clients expect a 2xx with an empty body.
            return new Response(null, { status: 200 });
          }

          return htmlResponse(
            "You have been unsubscribed. You will not receive further emails from this sender.",
            200,
          );
        }),
    },
  },
});

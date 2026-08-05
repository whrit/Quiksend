import { db, recordAudit } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { createFileRoute } from "@tanstack/react-router";
import { and, asc, eq, gt } from "drizzle-orm";
import { withAdminSession } from "@/lib/api/v1/lifecycle-auth.ts";

/**
 * Streamed organization data export (Task 5). Covers exactly the documented
 * record set — organization, members, prospects, sequences, enrollments,
 * messages, suppressions, webhook endpoints/deliveries, and the audit log.
 * Credentials, API keys, OAuth tokens, and SMTP secrets are never included:
 * mailbox rows (which hold SMTP/OAuth config) are out of scope entirely, and
 * `webhookEndpoint.secret` (the HMAC signing key) is explicitly excluded
 * from the one table that does carry a secret column.
 *
 * Streamed with bounded keyset pagination so memory stays flat regardless of
 * organization size — no table is ever loaded fully into memory.
 */

const PAGE_SIZE = 500;

async function writeJsonArray(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  key: string,
  fetchPage: (afterId: string | null) => Promise<{ id: string }[]>,
): Promise<void> {
  controller.enqueue(encoder.encode(`,"${key}":[`));
  let afterId: string | null = null;
  let wroteAny = false;
  for (;;) {
    const page = await fetchPage(afterId);
    if (page.length === 0) break;
    for (const row of page) {
      controller.enqueue(encoder.encode(`${wroteAny ? "," : ""}${JSON.stringify(row)}`));
      wroteAny = true;
    }
    afterId = page[page.length - 1]!.id;
    if (page.length < PAGE_SIZE) break;
  }
  controller.enqueue(encoder.encode("]"));
}

export const Route = createFileRoute("/api/v1/export")({
  server: {
    handlers: {
      GET: ({ request }: { request: Request }) =>
        withAdminSession(request, async (ctx) => {
          const orgId = ctx.organizationId;

          await recordAudit({
            organizationId: orgId,
            actorType: "user",
            actorId: ctx.userId,
            action: "organization.export",
            entityType: "organization",
            entityId: orgId,
          });

          const stream = new ReadableStream<Uint8Array>({
            async start(controller) {
              const encoder = new TextEncoder();
              try {
                const [org] = await db
                  .select()
                  .from(tables.organization)
                  .where(eq(tables.organization.id, orgId))
                  .limit(1);
                controller.enqueue(encoder.encode(`{"organization":${JSON.stringify(org ?? null)}`));

                await writeJsonArray(controller, encoder, "members", (afterId) =>
                  db
                    .select()
                    .from(tables.member)
                    .where(
                      and(
                        eq(tables.member.organizationId, orgId),
                        afterId ? gt(tables.member.id, afterId) : undefined,
                      ),
                    )
                    .orderBy(asc(tables.member.id))
                    .limit(PAGE_SIZE),
                );

                await writeJsonArray(controller, encoder, "prospects", (afterId) =>
                  db
                    .select()
                    .from(tables.prospect)
                    .where(
                      and(
                        eq(tables.prospect.organizationId, orgId),
                        afterId ? gt(tables.prospect.id, afterId) : undefined,
                      ),
                    )
                    .orderBy(asc(tables.prospect.id))
                    .limit(PAGE_SIZE),
                );

                await writeJsonArray(controller, encoder, "sequences", (afterId) =>
                  db
                    .select()
                    .from(tables.sequence)
                    .where(
                      and(
                        eq(tables.sequence.organizationId, orgId),
                        afterId ? gt(tables.sequence.id, afterId) : undefined,
                      ),
                    )
                    .orderBy(asc(tables.sequence.id))
                    .limit(PAGE_SIZE),
                );

                await writeJsonArray(controller, encoder, "enrollments", (afterId) =>
                  db
                    .select()
                    .from(tables.enrollment)
                    .where(
                      and(
                        eq(tables.enrollment.organizationId, orgId),
                        afterId ? gt(tables.enrollment.id, afterId) : undefined,
                      ),
                    )
                    .orderBy(asc(tables.enrollment.id))
                    .limit(PAGE_SIZE),
                );

                await writeJsonArray(controller, encoder, "messages", (afterId) =>
                  db
                    .select()
                    .from(tables.message)
                    .where(
                      and(
                        eq(tables.message.organizationId, orgId),
                        afterId ? gt(tables.message.id, afterId) : undefined,
                      ),
                    )
                    .orderBy(asc(tables.message.id))
                    .limit(PAGE_SIZE),
                );

                await writeJsonArray(controller, encoder, "suppressions", (afterId) =>
                  db
                    .select()
                    .from(tables.suppression)
                    .where(
                      and(
                        eq(tables.suppression.organizationId, orgId),
                        afterId ? gt(tables.suppression.id, afterId) : undefined,
                      ),
                    )
                    .orderBy(asc(tables.suppression.id))
                    .limit(PAGE_SIZE),
                );

                // Signing secret excluded — never leaves the server.
                await writeJsonArray(controller, encoder, "webhookEndpoints", (afterId) =>
                  db
                    .select({
                      id: tables.webhookEndpoint.id,
                      organizationId: tables.webhookEndpoint.organizationId,
                      url: tables.webhookEndpoint.url,
                      events: tables.webhookEndpoint.events,
                      status: tables.webhookEndpoint.status,
                      createdByUserId: tables.webhookEndpoint.createdByUserId,
                      createdAt: tables.webhookEndpoint.createdAt,
                      updatedAt: tables.webhookEndpoint.updatedAt,
                    })
                    .from(tables.webhookEndpoint)
                    .where(
                      and(
                        eq(tables.webhookEndpoint.organizationId, orgId),
                        afterId ? gt(tables.webhookEndpoint.id, afterId) : undefined,
                      ),
                    )
                    .orderBy(asc(tables.webhookEndpoint.id))
                    .limit(PAGE_SIZE),
                );

                await writeJsonArray(controller, encoder, "webhookDeliveries", (afterId) =>
                  db
                    .select()
                    .from(tables.webhookDelivery)
                    .where(
                      and(
                        eq(tables.webhookDelivery.organizationId, orgId),
                        afterId ? gt(tables.webhookDelivery.id, afterId) : undefined,
                      ),
                    )
                    .orderBy(asc(tables.webhookDelivery.id))
                    .limit(PAGE_SIZE),
                );

                await writeJsonArray(controller, encoder, "auditLog", (afterId) =>
                  db
                    .select()
                    .from(tables.auditLog)
                    .where(
                      and(
                        eq(tables.auditLog.organizationId, orgId),
                        afterId ? gt(tables.auditLog.id, afterId) : undefined,
                      ),
                    )
                    .orderBy(asc(tables.auditLog.id))
                    .limit(PAGE_SIZE),
                );

                controller.enqueue(encoder.encode("}"));
                controller.close();
              } catch (err) {
                controller.error(err);
              }
            },
          });

          return new Response(stream, {
            headers: {
              "Content-Type": "application/json",
              "Content-Disposition": `attachment; filename="organization-${orgId}-export.json"`,
            },
          });
        }),
    },
  },
});

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { captureManualAnchorForEnrollment } from "./anchor.server.ts";
import { authMiddleware } from "./org-fn.ts";

// Server-only helper is re-exported here so existing server-fn callers keep the
// same import path. Type-only export erases at build time; the value lives in
// `anchor.server.ts` (marked server-only, mocked on the client).
export type { CaptureManualAnchorInput } from "./anchor.server.ts";
export { captureManualAnchorForEnrollment };

export const captureManualAnchor = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) =>
    z
      .object({
        enrollmentId: z.string().uuid(),
        messageId: z.string().min(1),
        threadId: z.string().min(1),
        providerMessageId: z.string().min(1),
        sentAt: z.string().datetime(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await captureManualAnchorForEnrollment({
      enrollmentId: data.enrollmentId,
      organizationId: context.orgContext.organizationId,
      messageId: data.messageId,
      threadId: data.threadId,
      providerMessageId: data.providerMessageId,
      sentAt: new Date(data.sentAt),
    });
    return { ok: true };
  });

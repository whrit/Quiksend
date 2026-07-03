import { logger } from "@quiksend/config";
import { transition } from "@quiksend/core/state-machine";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { getPostHog } from "@quiksend/observability";
import { and, eq } from "drizzle-orm";
import { applyTransitionEffects } from "./effects.ts";
import { loadContext } from "./load-context.ts";
import { type EnrollmentContext, toSnapshot } from "./context.ts";

export interface InboundEmail {
  readonly id: string;
  readonly organizationId: string;
  readonly mailboxId: string;
  readonly providerMessageId: string;
  readonly providerThreadId: string | null;
  readonly messageIdHeader: string | null;
  readonly inReplyTo: string | null;
  readonly references: string | null;
  readonly subject: string | null;
  readonly bodyHtml: string | null;
  readonly bodyText: string | null;
  readonly fromEmail: string | null;
  readonly bounceType: "hard" | "soft" | null;
  readonly receivedAt: Date;
  readonly enrollmentId: string | null;
}

export async function handleInboundReply(
  inbound: InboundEmail,
  enrollmentId: string,
): Promise<void> {
  const ctx = await loadContext(enrollmentId);
  const snapshot = toSnapshot(ctx);
  const { nextState, effects } = transition(snapshot, {
    kind: "reply_received",
    at: inbound.receivedAt,
    stopOnReply: ctx.stopOnReply,
  });

  await db.transaction(async (tx) => {
    await applyTransitionEffects(tx, ctx, effects, 0, nextState);
  });

  await emitProductEvents(ctx, effects);
  logger.info(
    {
      organizationId: inbound.organizationId,
      enrollmentId,
      messageId: inbound.id,
      nextState,
    },
    "inbound reply processed",
  );
}

export async function handleInboundBounce(
  inbound: InboundEmail,
  enrollmentId: string,
): Promise<void> {
  const bounceType = inbound.bounceType ?? "hard";
  const ctx = await loadContext(enrollmentId);
  const snapshot = toSnapshot(ctx);
  const { nextState, effects } = transition(snapshot, {
    kind: "bounce_received",
    bounceType,
    at: inbound.receivedAt,
  });

  await db.transaction(async (tx) => {
    await applyTransitionEffects(tx, ctx, effects, 0, nextState);

    if (bounceType === "hard" && inbound.fromEmail) {
      const email = inbound.fromEmail.toLowerCase();
      await tx
        .insert(tables.suppression)
        .values({
          organizationId: inbound.organizationId,
          value: email,
          valueType: "email",
          reason: "bounce",
          sourceMessageId: inbound.id,
        })
        .onConflictDoNothing();

      await tx
        .update(tables.prospect)
        .set({ status: "bounced" })
        .where(
          and(
            eq(tables.prospect.organizationId, inbound.organizationId),
            eq(tables.prospect.email, email),
          ),
        );
    }
  });

  await emitProductEvents(ctx, effects);
  logger.info(
    {
      organizationId: inbound.organizationId,
      enrollmentId,
      messageId: inbound.id,
      bounceType,
      nextState,
    },
    "inbound bounce processed",
  );
}

async function emitProductEvents(
  ctx: EnrollmentContext,
  effects: readonly { kind: string; type?: string }[],
): Promise<void> {
  const posthog = getPostHog();
  for (const effect of effects) {
    if (effect.kind !== "emit_event" || !effect.type) continue;
    logger.info(
      {
        organizationId: ctx.organizationId,
        enrollmentId: ctx.enrollmentId,
        event: effect.type,
      },
      "enrollment event",
    );
    posthog?.capture({
      distinctId: ctx.enrollment.createdByUserId,
      event: effect.type,
      properties: {
        organizationId: ctx.organizationId,
        enrollmentId: ctx.enrollmentId,
        sequenceId: ctx.sequence.id,
        prospectId: ctx.prospect.id,
      },
    });
  }
}

import { isInsideWindow, nextOpenSlot } from "@quiksend/core/schedule";
import { db, tables } from "@quiksend/db";
import { and, asc, eq, gte, inArray, sql, desc } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "@quiksend/db/schema";
import { toMailboxSchedule, type EnrollmentContext } from "./context.ts";

type DbTx = PostgresJsDatabase<typeof schema>;

const ROLLING_WINDOW_MS = 24 * 60 * 60 * 1000;

export function startOfWindow(at: Date): Date {
  return new Date(at.getTime() - ROLLING_WINDOW_MS);
}

async function loadMailbox(tx: DbTx, mailboxId: string, organizationId: string) {
  const row = await tx.query.mailbox.findFirst({
    where: and(eq(tables.mailbox.id, mailboxId), eq(tables.mailbox.organizationId, organizationId)),
  });
  if (!row) throw new Error(`Mailbox not found: ${mailboxId}`);
  return row;
}

async function lastSendAt(
  tx: DbTx,
  mailboxId: string,
  organizationId: string,
): Promise<Date | null> {
  const rows = await tx
    .select({ sentAt: tables.message.sentAt })
    .from(tables.message)
    .where(
      and(
        eq(tables.message.mailboxId, mailboxId),
        eq(tables.message.organizationId, organizationId),
        eq(tables.message.direction, "outbound"),
        eq(tables.message.status, "sent"),
      ),
    )
    .orderBy(desc(tables.message.sentAt))
    .limit(1);
  return rows[0]?.sentAt ?? null;
}

async function countReservationsInWindow(tx: DbTx, mailboxId: string, at: Date): Promise<number> {
  const windowStart = startOfWindow(at);
  const rows = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(tables.sendReservation)
    .where(
      and(
        eq(tables.sendReservation.mailboxId, mailboxId),
        gte(tables.sendReservation.reservedAt, windowStart),
        inArray(tables.sendReservation.status, ["held", "sent"]),
      ),
    );
  return rows[0]?.count ?? 0;
}

async function oldestReservationTime(tx: DbTx, mailboxId: string, at: Date): Promise<Date> {
  const windowStart = startOfWindow(at);
  const rows = await tx
    .select({ reservedAt: tables.sendReservation.reservedAt })
    .from(tables.sendReservation)
    .where(
      and(
        eq(tables.sendReservation.mailboxId, mailboxId),
        gte(tables.sendReservation.reservedAt, windowStart),
        inArray(tables.sendReservation.status, ["held", "sent"]),
      ),
    )
    .orderBy(asc(tables.sendReservation.reservedAt))
    .limit(1);
  const oldest = rows[0]?.reservedAt;
  if (!oldest) return at;
  return oldest;
}

export async function reserveSendSlotInTx(
  tx: DbTx,
  mailboxId: string,
  enrollmentId: string,
  organizationId: string,
  at: Date,
  settings: EnrollmentContext["settings"],
): Promise<{ ok: true; reservationId: number } | { ok: false; deferUntil: Date }> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${mailboxId}))`);

  const mailbox = await loadMailbox(tx, mailboxId, organizationId);
  const schedule = toMailboxSchedule(mailbox.sendWindow, mailbox, settings);
  const skipWindow = process.env.QUIKSEND_ENGINE_FAKE_MAIL === "1";

  if (!skipWindow && !isInsideWindow(at, schedule)) {
    const deferUntil = nextOpenSlot(at, schedule, settings.business_days_only);
    return { ok: false, deferUntil };
  }

  const lastSend = await lastSendAt(tx, mailboxId, organizationId);
  if (lastSend && (at.getTime() - lastSend.getTime()) / 1000 < mailbox.throttleSeconds) {
    return {
      ok: false,
      deferUntil: new Date(lastSend.getTime() + mailbox.throttleSeconds * 1000),
    };
  }

  const usedInWindow = await countReservationsInWindow(tx, mailboxId, at);
  if (usedInWindow >= mailbox.dailyCap) {
    const oldestInWindow = await oldestReservationTime(tx, mailboxId, at);
    const deferUntil = new Date(oldestInWindow.getTime() + ROLLING_WINDOW_MS);
    return { ok: false, deferUntil };
  }

  const [row] = await tx
    .insert(tables.sendReservation)
    .values({
      mailboxId,
      enrollmentId,
      windowStart: startOfWindow(at),
      status: "held",
    })
    .returning({ id: tables.sendReservation.id });

  if (!row) throw new Error("Failed to create send reservation");
  return { ok: true, reservationId: row.id };
}

export async function markReservationSentInTx(tx: DbTx, reservationId: number): Promise<void> {
  await tx
    .update(tables.sendReservation)
    .set({ status: "sent" })
    .where(eq(tables.sendReservation.id, reservationId));
}

export async function releaseReservationInTx(tx: DbTx, reservationId: number): Promise<void> {
  await tx
    .update(tables.sendReservation)
    .set({ status: "released" })
    .where(eq(tables.sendReservation.id, reservationId));
}

/** @deprecated Use reserveSendSlotInTx inside the executor transaction. */
export async function reserveSendSlot(
  mailboxId: string,
  enrollmentId: string,
  organizationId: string,
  at: Date,
  settings: EnrollmentContext["settings"],
): Promise<{ ok: true; reservationId: number } | { ok: false; deferUntil: Date }> {
  return db.transaction((tx) =>
    reserveSendSlotInTx(tx, mailboxId, enrollmentId, organizationId, at, settings),
  );
}

/** @deprecated Use markReservationSentInTx inside the executor transaction. */
export async function markReservationSent(reservationId: number): Promise<void> {
  await db
    .update(tables.sendReservation)
    .set({ status: "sent" })
    .where(eq(tables.sendReservation.id, reservationId));
}

/** @deprecated Use releaseReservationInTx inside the executor transaction. */
export async function releaseReservation(reservationId: number): Promise<void> {
  await db
    .update(tables.sendReservation)
    .set({ status: "released" })
    .where(eq(tables.sendReservation.id, reservationId));
}

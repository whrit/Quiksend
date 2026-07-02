import { describe, expect, it } from "vitest";
import { computeSchedule } from "./compute-schedule.ts";
import { isInsideWindow, nextOpenSlot } from "./sending-window.ts";
import type { MailboxSchedule, SequenceStepSpec } from "./types.ts";

const nyMailbox: MailboxSchedule = {
  timezone: "America/New_York",
  window: {
    mon: [{ startHour: 9, endHour: 17 }],
    tue: [{ startHour: 9, endHour: 17 }],
    wed: [{ startHour: 9, endHour: 17 }],
    thu: [{ startHour: 9, endHour: 17 }],
    fri: [{ startHour: 9, endHour: 17 }],
  },
  dailyCap: 3,
  minGapSeconds: 60,
};

const step = (
  index: number,
  kind: SequenceStepSpec["kind"],
  delayMinutes: number,
): SequenceStepSpec => ({
  index,
  kind,
  delayMinutes,
  businessDaysOnly: true,
});

describe("sending-window", () => {
  it("recognizes 10:00 EST Monday as inside window", () => {
    // 2026-01-05 is a Monday. 10:00 EST = 15:00 UTC (EST is UTC-5).
    const inside = new Date("2026-01-05T15:00:00Z");
    expect(isInsideWindow(inside, nyMailbox)).toBe(true);
  });

  it("recognizes 8:00 EST Monday as outside window", () => {
    const outside = new Date("2026-01-05T13:00:00Z");
    expect(isInsideWindow(outside, nyMailbox)).toBe(false);
  });

  it("nextOpenSlot returns input when already inside window", () => {
    const inside = new Date("2026-01-05T15:00:00Z");
    expect(nextOpenSlot(inside, nyMailbox, true).getTime()).toBe(inside.getTime());
  });

  it("nextOpenSlot advances Sunday to Monday 9am EST", () => {
    // 2026-01-04 = Sunday. Any hour → next legal is 2026-01-05T14:00Z (9am EST).
    const sunday = new Date("2026-01-04T20:00:00Z");
    const next = nextOpenSlot(sunday, nyMailbox, true);
    expect(next.toISOString()).toBe("2026-01-05T14:00:00.000Z");
  });

  it("nextOpenSlot advances Friday-after-window to Monday", () => {
    // 2026-01-02 = Friday. 22:00Z = 17:00 EST (window ends 17:00 exclusive).
    const fri = new Date("2026-01-02T22:00:00Z");
    const next = nextOpenSlot(fri, nyMailbox, true);
    expect(next.toISOString()).toBe("2026-01-05T14:00:00.000Z");
  });
});

describe("computeSchedule", () => {
  it("respects delayMinutes on the trivial happy path", () => {
    const anchor = new Date("2026-01-05T15:00:00Z"); // Mon 10:00 EST
    const steps = [step(0, "auto_email", 60), step(1, "auto_email", 60)];
    const out = computeSchedule(steps, nyMailbox, anchor);

    expect(out).toHaveLength(2);
    expect(out[0]?.scheduledAt.toISOString()).toBe("2026-01-05T16:00:00.000Z");
    expect(out[1]?.scheduledAt.toISOString()).toBe("2026-01-05T17:00:00.000Z");
    // Fri window ends 17:00 EST = 22:00 UTC — 17:00Z is well before.
    expect(out[1]?.deferredBy).toEqual([]);
  });

  it("defers a step whose raw time falls after the window closes", () => {
    // Anchor 16:30 EST + 60min = 17:30 EST → outside window → next Mon 9am EST.
    const anchor = new Date("2026-01-05T21:30:00Z");
    const steps = [step(0, "auto_email", 60)];
    const out = computeSchedule(steps, nyMailbox, anchor);
    expect(out[0]?.scheduledAt.toISOString()).toBe("2026-01-06T14:00:00.000Z");
    expect(out[0]?.deferredBy[0]?.kind).toBe("outside_window");
  });

  it("enforces daily cap over a rolling 24h window", () => {
    // Send 4 back-to-back — cap is 3, so #4 must slide past 24h from #1.
    const anchor = new Date("2026-01-05T14:00:00Z"); // Mon 9am EST
    const steps = [
      step(0, "auto_email", 0),
      step(1, "auto_email", 5),
      step(2, "auto_email", 5),
      step(3, "auto_email", 5),
    ];
    const out = computeSchedule(steps, nyMailbox, anchor);
    // Steps 0..2 should fit; step 3 must be at least 24h after step 0, snapped
    // to Tuesday's window.
    expect(out[0]?.scheduledAt.toISOString()).toBe("2026-01-05T14:00:00.000Z");
    expect(out[3]?.deferredBy.some((d) => d.kind === "daily_cap")).toBe(true);
    expect(out[3]!.scheduledAt.getTime()).toBeGreaterThanOrEqual(
      out[0]!.scheduledAt.getTime() + 24 * 60 * 60 * 1000,
    );
  });

  it("enforces minGapSeconds between sends", () => {
    const tightMailbox: MailboxSchedule = { ...nyMailbox, minGapSeconds: 600 };
    const anchor = new Date("2026-01-05T14:00:00Z");
    const steps = [step(0, "auto_email", 0), step(1, "auto_email", 1)];
    const out = computeSchedule(steps, tightMailbox, anchor);
    const gap = (out[1]!.scheduledAt.getTime() - out[0]!.scheduledAt.getTime()) / 1000;
    expect(gap).toBeGreaterThanOrEqual(600);
    expect(out[1]?.deferredBy.some((d) => d.kind === "throttle")).toBe(true);
  });

  it("passes wait/manual/task steps through without send-constraint checks", () => {
    const anchor = new Date("2026-01-05T15:00:00Z");
    const steps = [step(0, "wait", 30), step(1, "task", 15), step(2, "manual_email", 60)];
    const out = computeSchedule(steps, nyMailbox, anchor);
    expect(out).toHaveLength(3);
    // No deferrals for non-send steps.
    expect(out.every((s) => s.deferredBy.length === 0)).toBe(true);
  });
});

import { addDays } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import {
  BUSINESS_DAYS,
  type HourRange,
  type SendingWindow,
  type TimeZone,
  type Weekday,
} from "./types.ts";

/**
 * Timezone math for sending-window enforcement.
 *
 * IMPORTANT: `date-fns-tz`'s `toZonedTime` returns a Date whose local getters
 * (`getHours`, `getDay`) only yield the target-zone wall clock when the JS
 * runtime timezone happens to be UTC — which is a portability trap (dev
 * machines are rarely UTC; CI often is; production varies). We sidestep the
 * trap entirely by:
 *   • reading wall-clock components via `formatInTimeZone` (returns strings
 *     grounded in the target zone regardless of host TZ), and
 *   • building UTC instants from a zoned wall-clock via `fromZonedTime`
 *     (host-TZ-independent by construction).
 */

const WEEKDAY_BY_ISO_INDEX: Readonly<Record<string, Weekday>> = {
  Sun: "sun",
  Mon: "mon",
  Tue: "tue",
  Wed: "wed",
  Thu: "thu",
  Fri: "fri",
  Sat: "sat",
};

interface WallClock {
  readonly dateStr: string; // "yyyy-MM-dd"
  readonly hourFractional: number; // 0.0 – 24.0
  readonly weekday: Weekday;
}

function wallClockIn(at: Date, tz: TimeZone): WallClock {
  const [dateStr, hh, mm, ss, dow] = formatInTimeZone(at, tz, "yyyy-MM-dd HH mm ss EEE").split(" ");
  if (!dateStr || !hh || !mm || !ss || !dow)
    throw new Error(`Failed to format wall clock in ${tz}`);
  const weekday = WEEKDAY_BY_ISO_INDEX[dow];
  if (!weekday) throw new Error(`Unknown weekday token ${dow}`);
  const hourFractional = Number(hh) + Number(mm) / 60 + Number(ss) / 3600;
  return { dateStr, hourFractional, weekday };
}

function ranges(window: SendingWindow, day: Weekday): readonly HourRange[] {
  return window[day] ?? [];
}

export function isBusinessDay(day: Weekday): boolean {
  return BUSINESS_DAYS.includes(day);
}

/** Is `at` inside the mailbox's sending window? Business-day gating is separate. */
export function isInsideWindow(
  at: Date,
  mailbox: { timezone: TimeZone; window: SendingWindow },
): boolean {
  const wc = wallClockIn(at, mailbox.timezone);
  return ranges(mailbox.window, wc.weekday).some(
    (r) => wc.hourFractional >= r.startHour && wc.hourFractional < r.endHour,
  );
}

/**
 * Advance `from` (UTC) forward to the earliest UTC instant that satisfies:
 *   • the mailbox's per-weekday window
 *   • the business-days-only guard (when set)
 * Returns `from` unchanged when already legal.
 */
export function nextOpenSlot(
  from: Date,
  mailbox: { timezone: TimeZone; window: SendingWindow },
  businessDaysOnly: boolean,
): Date {
  for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
    const candidateUtc =
      dayOffset === 0 ? from : startOfLocalDay(addDays(from, dayOffset), mailbox.timezone);
    const wc = wallClockIn(candidateUtc, mailbox.timezone);

    if (businessDaysOnly && !isBusinessDay(wc.weekday)) continue;
    const dayRanges = ranges(mailbox.window, wc.weekday);
    if (dayRanges.length === 0) continue;

    const sorted = dayRanges.toSorted((a, b) => a.startHour - b.startHour);
    for (const range of sorted) {
      const start = utcAtLocalHour(wc.dateStr, range.startHour, mailbox.timezone);
      const end = utcAtLocalHour(wc.dateStr, range.endHour, mailbox.timezone);
      if (candidateUtc >= start && candidateUtc < end) return candidateUtc;
      if (candidateUtc < start) return start;
    }
  }
  throw new Error("No open sending slot within 7 days — mailbox window is empty.");
}

function startOfLocalDay(at: Date, tz: TimeZone): Date {
  const dateStr = formatInTimeZone(at, tz, "yyyy-MM-dd");
  return fromZonedTime(`${dateStr}T00:00:00`, tz);
}

function utcAtLocalHour(dateStr: string, hour: number, tz: TimeZone): Date {
  const wholeHour = Math.floor(hour);
  const minutes = Math.floor((hour - wholeHour) * 60);
  const hh = String(wholeHour).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  return fromZonedTime(`${dateStr}T${hh}:${mm}:00`, tz);
}

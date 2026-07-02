/**
 * Schedule/window/throttle types shared by the sequence builder preview and the
 * worker executor. Same input → same output for both.
 */

/** IANA timezone id, e.g. "America/New_York". */
export type TimeZone = string;

/** Weekday keys aligned with `Date.getUTCDay()` where 0 = Sunday. */
export type Weekday = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";

export const WEEKDAYS: readonly Weekday[] = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
] as const;
export const BUSINESS_DAYS: readonly Weekday[] = ["mon", "tue", "wed", "thu", "fri"] as const;

/** Local wall-clock hour range within a sending window (0–24, end exclusive). */
export interface HourRange {
  readonly startHour: number;
  readonly endHour: number;
}

/**
 * Per-weekday sending windows for a mailbox. A missing key means "no sending
 * that day." Multiple ranges per day are allowed (rare, but supported).
 */
export type SendingWindow = Partial<Record<Weekday, readonly HourRange[]>>;

export interface MailboxSchedule {
  readonly timezone: TimeZone;
  readonly window: SendingWindow;
  /** Maximum sends per rolling 24h window. */
  readonly dailyCap: number;
  /** Minimum seconds between two sends on this mailbox. */
  readonly minGapSeconds: number;
}

export type StepKind = "manual_email" | "auto_email" | "wait" | "task";

export interface SequenceStepSpec {
  readonly index: number;
  readonly kind: StepKind;
  /** Time after previous step completion; the wait step's own duration lives here. */
  readonly delayMinutes: number;
  readonly businessDaysOnly: boolean;
}

export interface ScheduledStep {
  readonly index: number;
  readonly kind: StepKind;
  /** Earliest legal send time in UTC. */
  readonly scheduledAt: Date;
  /** Reason for any deferral relative to raw `previous + delay`. */
  readonly deferredBy: readonly ScheduleDeferral[];
}

export type ScheduleDeferral =
  | { readonly kind: "outside_window"; readonly nextOpen: Date }
  | { readonly kind: "business_day"; readonly nextBusinessDay: Date }
  | { readonly kind: "throttle"; readonly gapSeconds: number }
  | { readonly kind: "daily_cap"; readonly resetAt: Date };

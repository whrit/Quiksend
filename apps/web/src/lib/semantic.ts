/**
 * The colour contract, in code.
 *
 * Every status→hue and type→hue mapping lives here so a hue means one thing
 * app-wide. Green meaning "delivered" in a table and "selected" in a filter is
 * the fastest way to make a coherent system feel arbitrary.
 *
 * The CSS side of the contract is documented at the top of `styles/app.css`.
 */

/** Semantic roles. State only — never used to type a record. */
export type Tone = "pos" | "warn" | "neg" | "brand" | "neutral";

/** Categorical hues. Type only — no valence. */
export type Cat = "c1" | "c2" | "c3" | "c4" | "c5" | "c6";

export const pillClass = (tone: Tone): string => `pill pill-${tone}`;
export const tileClass = (size: "xs" | "sm" | "md" | "lg", hue: Tone | Cat, tint = false): string =>
  `tile tile-${size} hue-${hue}${tint ? " tile-tint" : ""}`;

/* ── Enrollment / sequence state ─────────────────────────────────────────── */

const ENROLLMENT_TONE: Record<string, Tone> = {
  active: "brand",
  waiting: "neutral",
  waiting_manual: "warn",
  paused: "warn",
  replied: "pos",
  completed: "pos",
  stopped: "neutral",
  bounced: "neg",
  failed: "neg",
};

export const enrollmentTone = (state: string): Tone => ENROLLMENT_TONE[state] ?? "neutral";

const SEQUENCE_TONE: Record<string, Tone> = {
  active: "pos",
  draft: "neutral",
  archived: "neutral",
};

export const sequenceTone = (status: string): Tone => SEQUENCE_TONE[status] ?? "neutral";

/* ── Prospect status ─────────────────────────────────────────────────────── */

const PROSPECT_TONE: Record<string, Tone> = {
  new: "neutral",
  active: "pos",
  replied: "pos",
  bounced: "neg",
  unsubscribed: "neg",
  do_not_contact: "neg",
};

export const prospectTone = (status: string): Tone => PROSPECT_TONE[status] ?? "neutral";

/* ── Mailbox / delivery health ───────────────────────────────────────────── */

export const healthTone = (ok: boolean | null | undefined): Tone =>
  ok === true ? "pos" : ok === false ? "neg" : "neutral";

/** Label so health is never communicated by colour alone. */
export const healthLabel = (ok: boolean | null | undefined): string =>
  ok === true ? "Pass" : ok === false ? "Fail" : "Unchecked";

/* ── Email gateway family — TYPE, so categorical ─────────────────────────── */

const GATEWAY: Record<string, { cat: Cat; label: string }> = {
  google_workspace: { cat: "c4", label: "Google Workspace" },
  microsoft_365: { cat: "c1", label: "Microsoft 365" },
  proofpoint: { cat: "c2", label: "Proofpoint" },
  mimecast: { cat: "c3", label: "Mimecast" },
  barracuda: { cat: "c6", label: "Barracuda" },
  cisco_ironport: { cat: "c5", label: "Cisco IronPort" },
  trend_micro: { cat: "c5", label: "Trend Micro" },
  fortinet: { cat: "c6", label: "Fortinet" },
  sophos: { cat: "c2", label: "Sophos" },
  symantec: { cat: "c3", label: "Symantec" },
  zoho: { cat: "c4", label: "Zoho" },
  fastmail: { cat: "c4", label: "Fastmail" },
  other: { cat: "c6", label: "Other" },
  unknown: { cat: "c6", label: "Unknown" },
};

export const gatewayMeta = (g: string | null | undefined): { cat: Cat; label: string } =>
  (g && GATEWAY[g]) || { cat: "c6", label: "Unclassified" };

/* ── Sequence step kind — TYPE, so categorical ───────────────────────────── */

const STEP: Record<string, { cat: Cat; label: string }> = {
  manual_email: { cat: "c2", label: "Manual email" },
  auto_email: { cat: "c1", label: "Auto email" },
  wait: { cat: "c5", label: "Wait" },
  task: { cat: "c6", label: "Task" },
};

export const stepMeta = (kind: string): { cat: Cat; label: string } =>
  STEP[kind] ?? { cat: "c6", label: kind };

/* ── Mailbox sending provider — TYPE, so categorical ─────────────────────── */

const PROVIDER: Record<string, { cat: Cat; label: string }> = {
  gmail: { cat: "c2", label: "Gmail" },
  microsoft: { cat: "c1", label: "Microsoft" },
  smtp: { cat: "c4", label: "SMTP" },
};

export const providerMeta = (p: string | null | undefined): { cat: Cat; label: string } =>
  (p && PROVIDER[p]) || { cat: "c6", label: p ?? "Unknown" };

/* ── Mailbox status ──────────────────────────────────────────────────────── */

const MAILBOX_STATUS_TONE: Record<string, Tone> = {
  active: "pos",
  inactive: "neutral",
  error: "neg",
  paused: "warn",
};

export const mailboxStatusTone = (status: string): Tone => MAILBOX_STATUS_TONE[status] ?? "neutral";

/* ── CRM / webhook status ────────────────────────────────────────────────── */

const CONNECTION_STATUS_TONE: Record<string, Tone> = {
  active: "pos",
  error: "neg",
  syncing: "warn",
  inactive: "neutral",
  active_enabled: "pos",
  active_disabled: "warn",
};

export const connectionStatusTone = (status: string): Tone =>
  CONNECTION_STATUS_TONE[status] ?? "neutral";

/* ── Suppression reason ──────────────────────────────────────────────────── */

const SUPPRESSION_TONE: Record<string, Tone> = {
  bounce: "neg",
  complaint: "neg",
  unsubscribe: "neg",
  manual: "warn",
  do_not_contact: "neg",
};

export const suppressionTone = (reason: string): Tone => SUPPRESSION_TONE[reason] ?? "neutral";

/* ── Inbound reply sentiment ─────────────────────────────────────────────── */

const SENTIMENT: Record<string, { tone: Tone; label: string }> = {
  interested: { tone: "pos", label: "Interested" },
  not_now: { tone: "warn", label: "Not now" },
  objection: { tone: "neg", label: "Objection" },
  out_of_office: { tone: "warn", label: "Out of office" },
  unsubscribe_request: { tone: "neg", label: "Unsubscribe request" },
};

/** Tone and human label for an inbound reply sentiment. Returns null when the value is absent or unrecognised. */
export const sentimentMeta = (
  s: string | null | undefined,
): { tone: Tone; label: string } | null => (s ? (SENTIMENT[s] ?? null) : null);

/* ── Formatting ──────────────────────────────────────────────────────────── */

const DATE_FMT = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

/**
 * One date format app-wide (`12 Jan 2026`). Locale-default formatting produced
 * `7/27/2026, 1:17:00 PM` in tables, which is unreadable at a glance and
 * ambiguous internationally.
 */
export function formatDate(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const d = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(d.getTime()) ? null : DATE_FMT.format(d);
}

/** Coarse relative time for recency columns. Falls back to absolute past a week. */
export function formatRelative(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return null;
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  if (mins < 10080) return `${Math.round(mins / 1440)}d ago`;
  return DATE_FMT.format(d);
}

const NUM_FMT = new Intl.NumberFormat("en-US");
export const formatCount = (n: number): string => NUM_FMT.format(n);

/** Signed delta for a pill. Returns null when there is no prior value to compare. */
export function formatDelta(current: number, previous: number | null | undefined) {
  if (previous == null || previous === 0) return null;
  const pct = ((current - previous) / previous) * 100;
  const tone: Tone = pct > 0 ? "pos" : pct < 0 ? "neg" : "neutral";
  return { tone, label: `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%` };
}

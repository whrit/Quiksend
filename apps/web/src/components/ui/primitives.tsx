import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Cat, Tone } from "@/lib/semantic";

/**
 * The shared visual vocabulary. Pages compose these rather than re-deriving
 * status colours and paddings, which is how a system drifts.
 */

/* ── Icon tile ───────────────────────────────────────────────────────────── */

export function Tile({
  size = "sm",
  hue = "brand",
  tint = false,
  children,
  className,
}: {
  size?: "xs" | "sm" | "md" | "lg";
  hue?: Tone | Cat;
  /** Tinted for repeated inline metadata; solid for identity and emphasis. */
  tint?: boolean;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn("tile", `tile-${size}`, `hue-${hue}`, tint && "tile-tint", className)}
    >
      {children}
    </span>
  );
}

/* ── Pill ────────────────────────────────────────────────────────────────── */

export function Pill({
  tone = "neutral",
  dot = false,
  children,
  className,
}: {
  tone?: Tone;
  /** Adds a colour dot so status never rides on hue alone. */
  dot?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("pill", `pill-${tone}`, dot && "pill-dot", className)}>{children}</span>
  );
}

/* ── Named absence ───────────────────────────────────────────────────────── */

/** A blank cell reads as a rendering bug. Name what is missing instead. */
export function Absent({ children = "—" }: { children?: ReactNode }) {
  return <span className="absent">{children}</span>;
}

/* ── Metric: value / delta / label ───────────────────────────────────────── */

export function Metric({
  value,
  label,
  delta,
  className,
}: {
  value: ReactNode;
  label: string;
  delta?: { tone: Tone; label: string } | null;
  className?: string;
}) {
  return (
    <div className={cn("metric", className)}>
      <div className="metric-row">
        <span className="metric-value">{value}</span>
        {delta ? <Pill tone={delta.tone}>{delta.label}</Pill> : null}
      </div>
      <span className="metric-label">{label}</span>
    </div>
  );
}

/* ── Panel ───────────────────────────────────────────────────────────────── */

export function Panel({
  title,
  icon,
  hue = "neutral",
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: string;
  icon?: ReactNode;
  hue?: Tone | Cat;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("panel overflow-hidden", className)}>
      {title ? (
        <header className="panel-head">
          {icon ? (
            <Tile size="sm" hue={hue} tint>
              {icon}
            </Tile>
          ) : null}
          <h2 className="panel-title">{title}</h2>
          {actions ? <div className="ml-auto flex items-center gap-1.5">{actions}</div> : null}
        </header>
      ) : null}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

/* ── Empty state ─────────────────────────────────────────────────────────── */

export function EmptyState({
  icon,
  hue = "neutral",
  title,
  body,
  action,
}: {
  icon?: ReactNode;
  hue?: Tone | Cat;
  /** Name the situation, not the absence: "No prospects match" beats "No data". */
  title: string;
  /** One line saying what to do about it. */
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon ? (
        <Tile size="lg" hue={hue} tint className="mb-1">
          {icon}
        </Tile>
      ) : null}
      <p className="empty-title">{title}</p>
      <p className="empty-body">{body}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/* ── Skeleton rows ───────────────────────────────────────────────────────── */

/** Shape-matched loading for a table. Widths vary so it reads as text, not bars. */
export function SkeletonRows({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  const widths = ["62%", "88%", "45%", "70%", "55%", "80%"];
  return (
    <output aria-label="Loading" className="block">
      {Array.from({ length: rows }, (_row, r) => (
        <div key={r} className="flex h-12 items-center gap-3 border-b border-border px-3">
          {Array.from({ length: cols }, (_col, c) => (
            <div
              key={c}
              className="skel h-3"
              style={{ width: widths[(r + c) % widths.length], flex: c === 0 ? "0 0 22%" : "1" }}
            />
          ))}
        </div>
      ))}
    </output>
  );
}

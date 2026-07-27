import type { GatewayEvidence } from "@quiksend/mail/gateway-detect";
import { SEG_GATEWAYS } from "@quiksend/core/deliverability";
import { gatewayMeta } from "@/lib/semantic.ts";
import { cn } from "@/lib/utils";

/**
 * Gateway is a TYPE, so it takes a categorical hue — never a semantic one.
 * Proofpoint isn't "bad", it's a different filter to route around.
 *
 * Rendered as a colour chip plus the label rather than a coloured pill: the
 * previous version used fourteen raw Tailwind hues (outside the colour
 * contract, and unreadable in dark mode) and wrapped "Google Workspace" onto
 * two lines, which broke the row rhythm of the whole table.
 */

const GATEWAY_LABELS: Record<string, string> = {
  proofpoint: "Proofpoint",
  mimecast: "Mimecast",
  barracuda: "Barracuda",
  cisco_ironport: "Cisco IronPort",
  trend_micro: "Trend Micro",
  fortinet: "Fortinet",
  sophos: "Sophos",
  symantec: "Symantec",
  google_workspace: "Google Workspace",
  microsoft_365: "Microsoft 365",
  zoho: "Zoho",
  fastmail: "Fastmail",
  other: "Other",
  unknown: "Unknown",
};

function formatEvidence(evidence: GatewayEvidence[] | null | undefined): string {
  if (!evidence?.length) return "Classification pending";
  return evidence.map((e) => e.detail).join("; ");
}

export function GatewayBadge({
  gateway,
  evidence,
  className,
}: {
  gateway: string | null | undefined;
  evidence?: GatewayEvidence[] | null;
  className?: string;
}) {
  const { cat, label } = gatewayMeta(gateway);
  const isSeg = gateway ? (SEG_GATEWAYS as readonly string[]).includes(gateway) : false;

  return (
    <span
      className={cn("flex min-w-0 items-center gap-2", className)}
      title={`${label}${isSeg ? " — enterprise security gateway" : ""}. ${formatEvidence(evidence)}`}
    >
      <span aria-hidden className={cn("tile tile-xs !h-2.5 !w-2.5 !rounded-[3px]", `hue-${cat}`)} />
      <span className="truncate text-[0.75rem] text-[color:var(--paper-600)]">{label}</span>
      {/* SEG routing is the product's core concern, so it earns a mark of its own. */}
      {isSeg ? (
        <span
          aria-label="Enterprise security gateway"
          title="Enterprise security gateway"
          className="rounded-[3px] border border-border px-1 text-[0.5625rem] font-semibold tracking-wide text-[color:var(--paper-500)]"
        >
          SEG
        </span>
      ) : null}
    </span>
  );
}

export const GATEWAY_FILTER_OPTIONS = Object.entries(GATEWAY_LABELS).map(([value, label]) => ({
  value,
  label,
}));

export const SEG_GATEWAY_VALUES = SEG_GATEWAYS;

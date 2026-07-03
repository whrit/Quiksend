import type { GatewayEvidence } from "@quiksend/mail/gateway-detect";
import { SEG_GATEWAYS } from "@quiksend/core/deliverability";
import { Badge } from "@/components/ui/badge";

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

const GATEWAY_COLORS: Record<string, string> = {
  proofpoint: "bg-red-100 text-red-800 border-red-200",
  mimecast: "bg-orange-100 text-orange-800 border-orange-200",
  barracuda: "bg-orange-100 text-orange-900 border-orange-200",
  cisco_ironport: "bg-slate-100 text-slate-800 border-slate-200",
  trend_micro: "bg-purple-100 text-purple-800 border-purple-200",
  fortinet: "bg-red-50 text-red-700 border-red-100",
  sophos: "bg-blue-50 text-blue-800 border-blue-100",
  symantec: "bg-yellow-100 text-yellow-900 border-yellow-200",
  google_workspace: "bg-green-100 text-green-800 border-green-200",
  microsoft_365: "bg-blue-100 text-blue-800 border-blue-200",
  zoho: "bg-amber-100 text-amber-800 border-amber-200",
  fastmail: "bg-teal-100 text-teal-800 border-teal-200",
  other: "bg-gray-100 text-gray-700 border-gray-200",
  unknown: "bg-gray-100 text-gray-500 border-gray-200",
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
  const key = gateway ?? "unknown";
  const label = GATEWAY_LABELS[key] ?? "Unknown";
  const color = GATEWAY_COLORS[key] ?? GATEWAY_COLORS.unknown;

  return (
    <Badge
      variant="outline"
      className={`${color} ${className ?? ""}`}
      title={formatEvidence(evidence)}
    >
      {label}
    </Badge>
  );
}

export const GATEWAY_FILTER_OPTIONS = Object.entries(GATEWAY_LABELS).map(([value, label]) => ({
  value,
  label,
}));

export const SEG_GATEWAY_VALUES = SEG_GATEWAYS;

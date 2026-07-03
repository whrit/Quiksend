export type RoutingPolicy = "off" | "warn" | "enforce";

export type DeliverabilityPolicy = {
  routingPolicy: RoutingPolicy;
  routingPolicyChangedAt?: string;
  routingPolicyChangedBy?: string;
  contentSanitizerEnabled: boolean;
};

export type OrganizationMetadata = {
  postal_address?: string;
  deliverability?: Partial<DeliverabilityPolicy>;
};

const DEFAULT_POLICY: DeliverabilityPolicy = {
  routingPolicy: "off",
  contentSanitizerEnabled: false,
};

function parseRoutingPolicy(value: unknown): RoutingPolicy {
  if (value === "off" || value === "warn" || value === "enforce") return value;
  return "off";
}

/** Parses workspace deliverability policy from organization.metadata JSON text. */
export function parseDeliverabilityPolicy(
  metadataRaw: string | null | undefined,
): DeliverabilityPolicy {
  if (!metadataRaw) return { ...DEFAULT_POLICY };

  try {
    const parsed = JSON.parse(metadataRaw) as OrganizationMetadata;
    const raw = parsed.deliverability ?? {};
    const routingPolicy = parseRoutingPolicy(raw.routingPolicy);
    const contentSanitizerEnabled = raw.contentSanitizerEnabled ?? routingPolicy !== "off";
    return {
      routingPolicy,
      routingPolicyChangedAt: raw.routingPolicyChangedAt,
      routingPolicyChangedBy: raw.routingPolicyChangedBy,
      contentSanitizerEnabled,
    };
  } catch {
    return { ...DEFAULT_POLICY };
  }
}

/** Merges deliverability policy into existing organization.metadata JSON text. */
export function mergeDeliverabilityPolicy(
  metadataRaw: string | null | undefined,
  patch: {
    routingPolicy: RoutingPolicy;
    contentSanitizerEnabled?: boolean;
    changedBy: string;
  },
): string {
  let base: OrganizationMetadata = {};
  if (metadataRaw) {
    try {
      base = JSON.parse(metadataRaw) as OrganizationMetadata;
    } catch {
      base = {};
    }
  }

  const contentSanitizerEnabled = patch.contentSanitizerEnabled ?? patch.routingPolicy !== "off";

  const deliverability: DeliverabilityPolicy = {
    routingPolicy: patch.routingPolicy,
    routingPolicyChangedAt: new Date().toISOString(),
    routingPolicyChangedBy: patch.changedBy,
    contentSanitizerEnabled,
  };

  return JSON.stringify({
    ...base,
    deliverability,
  });
}

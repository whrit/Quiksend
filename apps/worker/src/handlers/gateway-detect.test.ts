import { eq, inArray } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, tables } from "@quiksend/db";
import { withTestOrgs } from "@quiksend/db/testing";
import type { GatewayApplyClassificationPayload, GatewayDetectBulkPayload } from "@quiksend/queue";
import { registerGatewayDetectHandlers } from "./gateway-detect.ts";

const detectMock = vi.hoisted(() => vi.fn<(email: string) => Promise<unknown>>());

vi.mock("@quiksend/mail/gateway-detect", () => ({
  detectEmailGateway: detectMock,
}));

const enqueueMock = vi.hoisted(() => vi.fn<() => Promise<string>>().mockResolvedValue("job-id"));

let detectBulkHandler: ((payload: GatewayDetectBulkPayload) => Promise<void>) | null = null;
let applyHandler: ((payload: GatewayApplyClassificationPayload) => Promise<void>) | null = null;

vi.mock("@quiksend/queue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@quiksend/queue")>();
  return {
    ...actual,
    registerHandler: vi.fn<
      (
        job: string,
        handler:
          | ((payload: GatewayDetectBulkPayload) => Promise<void>)
          | ((payload: GatewayApplyClassificationPayload) => Promise<void>),
      ) => Promise<void>
    >(async (job, handler) => {
      if (job === "gateway.detect_bulk") {
        detectBulkHandler = handler as (payload: GatewayDetectBulkPayload) => Promise<void>;
      }
      if (job === "gateway.apply_classification") {
        applyHandler = handler as (payload: GatewayApplyClassificationPayload) => Promise<void>;
      }
    }),
    enqueueWithRetries: enqueueMock,
  };
});

const DOMAIN_GATEWAYS = [
  "proofpoint.test",
  "mimecast.test",
  "barracuda.test",
  "cisco.test",
  "trend.test",
  "fortinet.test",
  "sophos.test",
  "symantec.test",
  "google.test",
  "m365.test",
  "zoho.test",
  "fastmail.test",
  "unknown1.test",
  "unknown2.test",
  "unknown3.test",
  "unknown4.test",
  "unknown5.test",
  "unknown6.test",
  "unknown7.test",
  "unknown8.test",
] as const;

const GATEWAY_BY_DOMAIN: Record<string, string> = {
  "proofpoint.test": "proofpoint",
  "mimecast.test": "mimecast",
  "barracuda.test": "barracuda",
  "cisco.test": "cisco_ironport",
  "trend.test": "trend_micro",
  "fortinet.test": "fortinet",
  "sophos.test": "sophos",
  "symantec.test": "symantec",
  "google.test": "google_workspace",
  "m365.test": "microsoft_365",
  "zoho.test": "zoho",
  "fastmail.test": "fastmail",
};

describe("gateway.detect lifecycle", () => {
  beforeEach(async () => {
    detectBulkHandler = null;
    applyHandler = null;
    vi.clearAllMocks();
    detectMock.mockImplementation(async (email: string) => {
      const domain = email.split("@")[1] ?? "unknown";
      const gateway = GATEWAY_BY_DOMAIN[domain] ?? "unknown";
      return {
        gateway,
        confidence: gateway === "unknown" ? "low" : "high",
        mxRecords: [`mx.${domain}`],
        evidence: [{ kind: "mx" as const, detail: `MX: mx.${domain}` }],
      };
    });
    await registerGatewayDetectHandlers();
    if (!detectBulkHandler || !applyHandler) throw new Error("handlers not registered");
  });

  it("classifies 200 prospects across 20 domains", async () => {
    await withTestOrgs(async ({ orgA }) => {
      await db
        .delete(tables.gatewayClassification)
        .where(inArray(tables.gatewayClassification.emailDomain, [...DOMAIN_GATEWAYS]));

      const emails: string[] = [];
      for (let i = 0; i < 200; i++) {
        const domain = DOMAIN_GATEWAYS[i % DOMAIN_GATEWAYS.length]!;
        emails.push(`prospect${i}@${domain}`);
      }

      for (const email of emails) {
        await db.insert(tables.prospect).values({
          organizationId: orgA.id,
          email,
          source: "csv",
        });
      }

      await detectBulkHandler!({ emails });

      expect(detectMock).toHaveBeenCalled();
      expect(enqueueMock).toHaveBeenCalledWith("gateway.apply_classification", {});

      const cached = await db.query.gatewayClassification.findMany({
        where: inArray(tables.gatewayClassification.emailDomain, [...DOMAIN_GATEWAYS]),
      });
      expect(cached.length).toBe(DOMAIN_GATEWAYS.length);

      await applyHandler!({ organizationId: orgA.id });

      const prospects = await db.query.prospect.findMany({
        where: eq(tables.prospect.organizationId, orgA.id),
      });
      expect(prospects.length).toBe(200);
      for (const prospect of prospects) {
        expect(prospect.emailGateway).not.toBeNull();
      }
    });
  });

  it("skips DNS on second bulk run when cache is fresh", async () => {
    await withTestOrgs(async () => {
      const cacheDomains = [
        `cache-a-${Date.now()}.rho-perf.com`,
        `cache-b-${Date.now()}.rho-perf.com`,
      ] as const;
      const emails = cacheDomains.map((domain, i) => `user${i}@${domain}`);

      await detectBulkHandler!({ emails });
      const firstCallCount = detectMock.mock.calls.length;
      expect(firstCallCount).toBe(cacheDomains.length);

      detectMock.mockClear();
      await detectBulkHandler!({ emails });
      expect(detectMock).not.toHaveBeenCalled();
    });
  });

  it("apply_classification bulk-updates by domain and enqueues one detect_bulk for missing", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const knownDomain = `known-cache-${Date.now()}.rho-perf.com`;
      const missingDomain = `missing-cache-${Date.now()}.rho-perf.com`;

      await db.insert(tables.gatewayClassification).values({
        emailDomain: knownDomain,
        gateway: "proofpoint",
        mxRecords: ["mx.proofpoint.test"],
        evidence: [{ kind: "mx", detail: "cached" }],
        confidence: "high",
        classifiedAt: new Date(),
        ttlUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      await db.insert(tables.prospect).values([
        {
          organizationId: orgA.id,
          email: `a@${knownDomain}`,
          source: "csv",
        },
        {
          organizationId: orgA.id,
          email: `b@${knownDomain}`,
          source: "csv",
        },
        {
          organizationId: orgA.id,
          email: `c@${missingDomain}`,
          source: "csv",
        },
      ]);

      await applyHandler!({ organizationId: orgA.id });

      const updated = await db.query.prospect.findMany({
        where: eq(tables.prospect.organizationId, orgA.id),
      });
      const knownProspects = updated.filter((p) => p.email.endsWith(`@${knownDomain}`));
      expect(knownProspects.every((p) => p.emailGateway === "proofpoint")).toBe(true);

      expect(enqueueMock).toHaveBeenCalledWith("gateway.detect_bulk", {
        emails: [`probe@${missingDomain}`],
      });
    });
  });

  it("apply_classification ignores expired cache entries", async () => {
    await withTestOrgs(async ({ orgA }) => {
      const domain = `stale-${Date.now()}.rho-perf.com`;
      await db.insert(tables.gatewayClassification).values({
        emailDomain: domain,
        gateway: "proofpoint",
        mxRecords: [],
        evidence: [],
        confidence: "high",
        classifiedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
        ttlUntil: new Date(Date.now() - 1000),
      });

      await db.insert(tables.prospect).values({
        organizationId: orgA.id,
        email: `user@${domain}`,
        source: "csv",
      });

      await applyHandler!({ organizationId: orgA.id });

      expect(enqueueMock).toHaveBeenCalledWith("gateway.detect_bulk", {
        emails: [`probe@${domain}`],
      });
    });
  });
});

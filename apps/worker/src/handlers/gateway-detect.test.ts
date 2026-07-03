import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@quiksend/db";
import { tables } from "@quiksend/db/tables";
import { withTestOrgs } from "@quiksend/db/testing";
import type {
  GatewayApplyClassificationPayload,
  GatewayDetectBulkPayload,
  GatewayDetectSinglePayload,
  GatewaySweepStalePayload,
} from "@quiksend/queue";
import { registerGatewayDetectHandlers } from "./gateway-detect.ts";

const detectMock = vi.hoisted(() => vi.fn<(email: string) => Promise<unknown>>());

vi.mock("@quiksend/mail/gateway-detect", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@quiksend/mail/gateway-detect")>();
  return {
    ...actual,
    detectEmailGateway: detectMock,
  };
});

const enqueueMock = vi.hoisted(() => vi.fn<() => Promise<string>>().mockResolvedValue("job-id"));

let detectBulkHandler: ((payload: GatewayDetectBulkPayload) => Promise<void>) | null = null;
let detectSingleHandler: ((payload: GatewayDetectSinglePayload) => Promise<void>) | null = null;
let sweepStaleHandler: ((payload: GatewaySweepStalePayload) => Promise<void>) | null = null;
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
      if (job === "gateway.detect_single") {
        detectSingleHandler = handler as (payload: GatewayDetectSinglePayload) => Promise<void>;
      }
      if (job === "gateway.sweep_stale") {
        sweepStaleHandler = handler as (payload: GatewaySweepStalePayload) => Promise<void>;
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
    detectSingleHandler = null;
    sweepStaleHandler = null;
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
    if (!detectBulkHandler || !applyHandler || !detectSingleHandler || !sweepStaleHandler) {
      throw new Error("handlers not registered");
    }
  });

  it("classifies 200 prospects across 20 domains", async () => {
    await withTestOrgs(async ({ orgA }) => {
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

      const cached = await db.query.gatewayClassification.findMany();
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

  it("gateway.apply_classification uses cache without DNS for known domains", async () => {
    await withTestOrgs(async ({ orgA }) => {
      await db.insert(tables.gatewayClassification).values({
        emailDomain: "cached-hit.test",
        gateway: "proofpoint",
        mxRecords: ["mx.cached-hit.test"],
        evidence: [{ kind: "mx", detail: "cached" }],
        confidence: "high",
        classifiedAt: new Date(),
        ttlUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      await db.insert(tables.prospect).values({
        organizationId: orgA.id,
        email: "user@cached-hit.test",
        source: "api",
      });

      detectMock.mockClear();
      await applyHandler!({ organizationId: orgA.id });

      expect(detectMock).not.toHaveBeenCalled();
      const prospect = await db.query.prospect.findFirst({
        where: eq(tables.prospect.organizationId, orgA.id),
      });
      expect(prospect?.emailGateway).toBe("proofpoint");
    });
  });

  it("gateway.detect_single performs DNS + cache write on cache miss", async () => {
    await withTestOrgs(async ({ orgA }) => {
      await db.insert(tables.prospect).values({
        organizationId: orgA.id,
        email: "user@fresh-miss.test",
        source: "api",
      });

      detectMock.mockClear();
      await detectSingleHandler!({ email: "user@fresh-miss.test" });

      expect(detectMock).toHaveBeenCalledWith("probe@fresh-miss.test");
      const cached = await db.query.gatewayClassification.findFirst({
        where: eq(tables.gatewayClassification.emailDomain, "fresh-miss.test"),
      });
      expect(cached).not.toBeNull();
    });
  });

  it("gateway.sweep_stale re-classifies expired cache rows", async () => {
    await withTestOrgs(async () => {
      await db.insert(tables.gatewayClassification).values({
        emailDomain: "stale-sweep.test",
        gateway: "unknown",
        mxRecords: [],
        evidence: [{ kind: "mx" as const, detail: "stale" }],
        confidence: "low",
        classifiedAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
        ttlUntil: new Date(Date.now() - 60 * 60 * 1000),
      });

      detectMock.mockImplementation(async (email: string) => {
        const domain = email.split("@")[1] ?? "unknown";
        return {
          gateway: "mimecast",
          confidence: "high",
          mxRecords: [`mx.${domain}`],
          evidence: [{ kind: "mx" as const, detail: `MX: mx.${domain}` }],
        };
      });

      await sweepStaleHandler!({});

      const row = await db.query.gatewayClassification.findFirst({
        where: eq(tables.gatewayClassification.emailDomain, "stale-sweep.test"),
      });
      expect(row?.gateway).toBe("mimecast");
    });
  });
});

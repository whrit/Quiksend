import { afterEach, describe, expect, it, vi } from "vitest";
import { detectEmailGateway, matchMxFingerprints, pickMxGateway } from "./gateway-detect.ts";
import { resolveMxRecords } from "./dns.ts";

vi.mock("./dns.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./dns.ts")>();
  return {
    ...actual,
    resolveMxRecords:
      vi.fn<
        () => Promise<{ records: { exchange: string; priority: number }[]; error: string | null }>
      >(),
    resolveTxtRecords: vi.fn<() => Promise<string[][]>>().mockResolvedValue([]),
  };
});

const resolveMxRecordsMock = vi.mocked(resolveMxRecords);

describe("detectEmailGateway", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  const segCases: Array<{ domain: string; mx: string; gateway: string }> = [
    { domain: "acme.com", mx: "mx1.pphosted.com", gateway: "proofpoint" },
    { domain: "mime.example", mx: "us-smtp-inbound-1.mimecast.com", gateway: "mimecast" },
    { domain: "barra.example", mx: "mx.barracudanetworks.com", gateway: "barracuda" },
    { domain: "cisco.example", mx: "mx.iphmx.com", gateway: "cisco_ironport" },
    { domain: "trend.example", mx: "tmes.trendmicro.com", gateway: "trend_micro" },
    { domain: "forti.example", mx: "mx.fortimail.com", gateway: "fortinet" },
    { domain: "sophos.example", mx: "mx.mail.sophos.com", gateway: "sophos" },
    { domain: "sym.example", mx: "cluster1.messagelabs.com", gateway: "symantec" },
  ];

  it.each(segCases)("detects $gateway from MX $mx", async ({ domain, mx, gateway }) => {
    resolveMxRecordsMock.mockResolvedValue({
      records: [{ exchange: mx, priority: 10 }],
      error: null,
    });

    const result = await detectEmailGateway(`user@${domain}`);
    expect(result.gateway).toBe(gateway);
    expect(result.confidence).toBe("high");
    expect(result.mxRecords).toContain(mx);
  });

  it("detects google_workspace", async () => {
    resolveMxRecordsMock.mockResolvedValue({
      records: [{ exchange: "aspmx.l.google.com", priority: 1 }],
      error: null,
    });
    const result = await detectEmailGateway("user@company.com");
    expect(result.gateway).toBe("google_workspace");
  });

  it("detects microsoft_365", async () => {
    resolveMxRecordsMock.mockResolvedValue({
      records: [{ exchange: "company-com.mail.protection.outlook.com", priority: 0 }],
      error: null,
    });
    const result = await detectEmailGateway("user@company.com");
    expect(result.gateway).toBe("microsoft_365");
  });

  it("prefers SEG over storage provider in split-brain MX chain", async () => {
    resolveMxRecordsMock.mockResolvedValue({
      records: [
        { exchange: "mx1.pphosted.com", priority: 10 },
        { exchange: "aspmx.l.google.com", priority: 20 },
      ],
      error: null,
    });

    const result = await detectEmailGateway("user@splitbrain.com");
    expect(result.gateway).toBe("proofpoint");
    expect(result.evidence.some((e) => e.detail.includes("aspmx.l.google.com"))).toBe(true);
    expect(result.evidence.some((e) => e.detail.includes("pphosted.com"))).toBe(true);
  });

  it("returns unknown on MX timeout with low confidence", async () => {
    resolveMxRecordsMock.mockResolvedValue({
      records: [],
      error: "MX lookup timeout",
    });

    const result = await detectEmailGateway("user@slow.com");
    expect(result.gateway).toBe("unknown");
    expect(result.confidence).toBe("low");
  });

  it("returns unknown on DNS SERVFAIL", async () => {
    resolveMxRecordsMock.mockResolvedValue({
      records: [],
      error: "querySrv ESERVFAIL _dmarc.servfail.com",
    });

    const result = await detectEmailGateway("user@servfail.com");
    expect(result.gateway).toBe("unknown");
  });

  it("returns unknown on empty MX records", async () => {
    resolveMxRecordsMock.mockResolvedValue({
      records: [],
      error: null,
    });

    const result = await detectEmailGateway("user@nomx.com");
    expect(result.gateway).toBe("unknown");
    expect(result.evidence.some((e) => e.detail.includes("No MX records"))).toBe(true);
  });
});

describe("pickMxGateway", () => {
  it("chooses SEG when both SEG and google_workspace match", () => {
    const matches = matchMxFingerprints(["mx1.pphosted.com", "aspmx.l.google.com"]);
    const picked = pickMxGateway(matches);
    expect(picked?.gateway).toBe("proofpoint");
  });
});

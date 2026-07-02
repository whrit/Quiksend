import * as dns from "node:dns/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkDomainAuth } from "./dns.ts";

vi.mock("node:dns/promises", () => ({
  resolveTxt: vi.fn<(host: string) => Promise<string[][]>>(),
}));

const resolveTxt = vi.mocked(dns.resolveTxt);

describe("checkDomainAuth", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("passes when SPF, DKIM, and DMARC records are present", async () => {
    resolveTxt.mockImplementation(async (host: string) => {
      if (host === "example.com") return [["v=spf1 include:_spf.google.com ~all"]];
      if (host === "default._domainkey.example.com") return [["v=DKIM1; k=rsa; p=abc123"]];
      if (host === "_dmarc.example.com") return [["v=DMARC1; p=none"]];
      throw new Error("ENOTFOUND");
    });

    const result = await checkDomainAuth("example.com");
    expect(result.spf.pass).toBe(true);
    expect(result.spf.mode).toBe("softfail");
    expect(result.dkim.pass).toBe(true);
    expect(result.dkim.selectors_found).toContain("default");
    expect(result.dmarc.pass).toBe(true);
    expect(result.dmarc.policy).toBe("none");
  });

  it("fails when all three checks miss", async () => {
    resolveTxt.mockRejectedValue(new Error("ENOTFOUND"));

    const result = await checkDomainAuth("missing.example");
    expect(result.spf.pass).toBe(false);
    expect(result.dkim.pass).toBe(false);
    expect(result.dmarc.pass).toBe(false);
  });

  it("fails SPF individually when no record exists", async () => {
    resolveTxt.mockImplementation(async (host: string) => {
      if (host === "default._domainkey.example.com") return [["v=DKIM1; p=key"]];
      if (host === "_dmarc.example.com") return [["v=DMARC1; p=reject"]];
      throw new Error("ENOTFOUND");
    });

    const result = await checkDomainAuth("example.com");
    expect(result.spf.pass).toBe(false);
    expect(result.dkim.pass).toBe(true);
    expect(result.dmarc.pass).toBe(true);
    expect(result.dmarc.policy).toBe("reject");
  });

  it("fails DKIM individually when no selector matches", async () => {
    resolveTxt.mockImplementation(async (host: string) => {
      if (host === "example.com") return [["v=spf1 mx -all"]];
      if (host === "_dmarc.example.com") return [["v=DMARC1; p=quarantine"]];
      throw new Error("ENOTFOUND");
    });

    const result = await checkDomainAuth("example.com");
    expect(result.spf.pass).toBe(true);
    expect(result.spf.mode).toBe("strict");
    expect(result.dkim.pass).toBe(false);
    expect(result.dmarc.pass).toBe(true);
  });

  it("uses first matching DKIM selector with public key", async () => {
    resolveTxt.mockImplementation(async (host: string) => {
      if (host === "example.com") return [["v=spf1 ~all"]];
      if (host === "default._domainkey.example.com") throw new Error("ENOTFOUND");
      if (host === "google._domainkey.example.com") return [["v=DKIM1; p=googlekey"]];
      if (host === "_dmarc.example.com") return [["v=DMARC1; p=none"]];
      throw new Error("ENOTFOUND");
    });

    const result = await checkDomainAuth("example.com");
    expect(result.dkim.pass).toBe(true);
    expect(result.dkim.selectors_found).toEqual(["google"]);
    expect(result.dkim.record).toContain("googlekey");
  });

  it("reports DMARC without a policy value", async () => {
    resolveTxt.mockImplementation(async (host: string) => {
      if (host === "example.com") return [["v=spf1 ?all"]];
      if (host === "default._domainkey.example.com") return [["v=DKIM1; p=key"]];
      if (host === "_dmarc.example.com") return [["v=DMARC1; sp=none"]];
      throw new Error("ENOTFOUND");
    });

    const result = await checkDomainAuth("example.com");
    expect(result.spf.mode).toBe("neutral");
    expect(result.dmarc.pass).toBe(true);
    expect(result.dmarc.policy).toBeNull();
    expect(result.dmarc.reason).toMatch(/no p= policy/i);
  });
});

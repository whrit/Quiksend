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
      if (host === "default._domainkey.example.com") return [["v=DKIM1; k=rsa; p=abc"]];
      if (host === "_dmarc.example.com") return [["v=DMARC1; p=none"]];
      throw new Error("ENOTFOUND");
    });

    const result = await checkDomainAuth("example.com");
    expect(result.spf.pass).toBe(true);
    expect(result.dkim.pass).toBe(true);
    expect(result.dmarc.pass).toBe(true);
  });

  it("fails when all three checks miss", async () => {
    resolveTxt.mockRejectedValue(new Error("ENOTFOUND"));

    const result = await checkDomainAuth("missing.example");
    expect(result.spf.pass).toBe(false);
    expect(result.dkim.pass).toBe(false);
    expect(result.dmarc.pass).toBe(false);
  });
});

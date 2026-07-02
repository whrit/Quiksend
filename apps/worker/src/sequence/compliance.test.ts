import { describe, expect, it, beforeAll } from "vitest";
import { buildComplianceParts, buildUnsubscribeUrl, verifyUnsubscribeToken } from "@quiksend/mail";
import { mintUnsubscribeToken } from "@quiksend/mail";

describe("auto-send compliance parts", () => {
  beforeAll(() => {
    process.env.UNSUBSCRIBE_TOKEN_SECRET =
      process.env.UNSUBSCRIBE_TOKEN_SECRET ?? "test-unsubscribe-secret-32-chars!!";
  });

  it("builds List-Unsubscribe with a verifiable signed token URL", () => {
    const prospectId = "11111111-1111-4111-8111-111111111111";
    const orgId = "22222222-2222-4222-8222-222222222222";
    const token = mintUnsubscribeToken({ prospectId, orgId });
    const unsubscribeUrl = buildUnsubscribeUrl("http://localhost:3000", token);

    const compliance = buildComplianceParts({
      unsubscribeUrl,
      senderPostalAddress: "123 Market St, San Francisco, CA 94103",
      senderOrgName: "Acme Corp",
    });

    expect(compliance.headers["List-Unsubscribe"]).toContain(unsubscribeUrl);
    expect(compliance.footerHtml).toContain("123 Market St, San Francisco, CA 94103");
    expect(compliance.footerHtml).not.toContain("1 Main St, City");
    expect(compliance.footerText).toContain("123 Market St, San Francisco, CA 94103");

    const url = new URL(unsubscribeUrl);
    const parsedToken = url.searchParams.get("token");
    expect(parsedToken).toBeTruthy();
    const payload = verifyUnsubscribeToken(parsedToken!);
    expect(payload).toEqual(expect.objectContaining({ prospectId, orgId: orgId }));
  });
});

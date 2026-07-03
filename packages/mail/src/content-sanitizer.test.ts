import { describe, expect, it } from "vitest";
import { sanitizeForSeg } from "./content-sanitizer.ts";

describe("sanitizeForSeg", () => {
  it("strips tracking pixels on the tracking domain", () => {
    const html = '<p>Hi</p><img src="https://app.example.com/t/open/abc" width="1" height="1" />';
    const result = sanitizeForSeg(
      { html, text: "Hi" },
      {
        stripTrackingPixel: true,
        stripExternalImages: false,
        preferPlainText: false,
        trackingDomain: "app.example.com",
      },
    );
    expect(result.html).not.toMatch(/<img/i);
    expect(result.text).toBe("Hi");
  });

  it("strips external images", () => {
    const html = '<p>Hi</p><img src="https://cdn.example.com/logo.png" />';
    const result = sanitizeForSeg(
      { html, text: "Hi" },
      {
        stripTrackingPixel: false,
        stripExternalImages: true,
        preferPlainText: false,
      },
    );
    expect(result.html).not.toMatch(/cdn\.example\.com/);
  });

  it("keeps data-uri images under size limit", () => {
    const dataUri = "data:image/png;base64,aaaa";
    const html = `<p>Hi</p><img src="${dataUri}" />`;
    const result = sanitizeForSeg(
      { html, text: "Hi" },
      {
        stripTrackingPixel: false,
        stripExternalImages: true,
        preferPlainText: false,
      },
    );
    expect(result.html).toContain(dataUri);
  });

  it("prefers plain text by dropping html", () => {
    const result = sanitizeForSeg(
      { html: "<p><strong>Hi</strong></p>", text: "Hi" },
      {
        stripTrackingPixel: false,
        stripExternalImages: false,
        preferPlainText: true,
      },
    );
    expect(result.html).toBe("");
    expect(result.text).toBe("Hi");
  });

  it("sanitizes multipart content while remaining usable", () => {
    const html =
      '<p>Hello</p><img src="https://track.local/pixel" /><img src="https://other.com/x.png" />';
    const result = sanitizeForSeg(
      { html, text: "Hello" },
      {
        stripTrackingPixel: true,
        stripExternalImages: true,
        preferPlainText: true,
        trackingDomain: "track.local",
      },
    );
    expect(result.html).toBe("");
    expect(result.text).toBe("Hello");
  });
});

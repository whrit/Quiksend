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

  it("prefers plain text by dropping html when plain text is complete", () => {
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

  it("keeps html when plain text is minimal vs full html", () => {
    const html = "<p><strong>Hello</strong> with <em>formatting</em> and more detail.</p>";
    const result = sanitizeForSeg(
      { html, text: "Hi" },
      {
        stripTrackingPixel: false,
        stripExternalImages: false,
        preferPlainText: true,
      },
    );
    expect(result.html).toBe(html);
    expect(result.text).toBe("Hi");
  });

  it("strips oversized inline data-uri images", () => {
    const bigPayload = "a".repeat(101 * 1024);
    const dataUri = `data:image/png;base64,${bigPayload}`;
    const html = `<p>Hi</p><img src="${dataUri}" />`;
    const result = sanitizeForSeg(
      { html, text: "Hi" },
      {
        stripTrackingPixel: false,
        stripExternalImages: true,
        preferPlainText: false,
      },
    );
    expect(result.html).not.toContain("data:image/png");
  });

  it("keeps inline data-uri images under 100KB", () => {
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

  it("strips tracking pixel but keeps non-tracking external image tag when not stripping externals", () => {
    const html =
      '<p>Hi</p><img src="https://track.example.com/pixel" width="1" /><img src="https://cdn.example.com/logo.png" />';
    const result = sanitizeForSeg(
      { html, text: "Hi" },
      {
        stripTrackingPixel: true,
        stripExternalImages: false,
        preferPlainText: false,
        trackingDomain: "track.example.com",
      },
    );
    expect(result.html).not.toMatch(/track\.example\.com/);
    expect(result.html).toContain("cdn.example.com");
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

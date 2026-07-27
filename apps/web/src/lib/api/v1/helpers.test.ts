import { describe, expect, it } from "vitest";
import { isAllowedWebhookUrl } from "./helpers.ts";

describe("isAllowedWebhookUrl", () => {
  it("rejects link-local and metadata IPv4 addresses", () => {
    expect(isAllowedWebhookUrl("http://169.254.169.254/")).toBe(false);
    expect(isAllowedWebhookUrl("http://169.254.1.1/")).toBe(false);
  });

  it("rejects 0.0.0.0", () => {
    expect(isAllowedWebhookUrl("http://0.0.0.0/")).toBe(false);
  });

  it("rejects IPv6 loopback", () => {
    expect(isAllowedWebhookUrl("https://[::1]/")).toBe(false);
  });

  it("rejects cloud metadata hostnames", () => {
    expect(isAllowedWebhookUrl("http://metadata.google.internal/")).toBe(false);
  });

  it("allows public HTTPS endpoints", () => {
    expect(isAllowedWebhookUrl("https://hooks.example.com/events")).toBe(true);
  });
});

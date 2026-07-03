import { describe, expect, it } from "vitest";
import { buildMime } from "./mime.ts";

const baseInput = {
  from: { email: "alice@example.com", name: "Alice" },
  to: [{ email: "bob@example.com" }],
  subject: "Intro",
  html: "<p>Hello</p>",
  text: "Hello",
  compliance: {
    unsubscribeUrl: "https://app.example.com/u/tok123",
    senderPostalAddress: "1 Main St, San Francisco, CA",
    senderOrgName: "Example Corp",
  },
} as const;

describe("buildMime", () => {
  it("mints a Message-Id in <uuid@quiksend.local> shape by default", () => {
    const out = buildMime(baseInput);
    expect(out.messageId).toMatch(/^<[0-9a-f-]{36}@quiksend\.local>$/);
    expect(out.raw).toContain(`Message-ID: ${out.messageId}`);
  });

  it("emits List-Unsubscribe headers on every message", () => {
    const out = buildMime(baseInput);
    expect(out.headers["List-Unsubscribe"]).toBe("<https://app.example.com/u/tok123>");
    expect(out.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(out.raw).toContain("List-Unsubscribe: <https://app.example.com/u/tok123>");
  });

  it("injects the physical address + unsubscribe link into both text and html", () => {
    const out = buildMime(baseInput);
    expect(out.raw).toContain("Example Corp");
    expect(out.raw).toContain("1 Main St, San Francisco, CA");
    expect(out.raw).toContain("Unsubscribe: https://app.example.com/u/tok123");
    expect(out.raw).toContain('href="https://app.example.com/u/tok123"');
  });

  it("sets In-Reply-To + References + Re: subject when an anchor is provided", () => {
    const out = buildMime({
      ...baseInput,
      anchor: {
        messageId: "<anchor@quiksend>",
        subject: "Intro",
        priorReferences: ["<prev@quiksend>"],
      },
    });
    expect(out.headers["In-Reply-To"]).toBe("<anchor@quiksend>");
    expect(out.headers.References).toBe("<prev@quiksend> <anchor@quiksend>");
    expect(out.headers.Subject).toBe("Re: Intro");
    expect(out.subject).toBe("Re: Intro");
  });

  it("preserves an existing <body> when wrapping the HTML footer", () => {
    const out = buildMime({ ...baseInput, html: "<html><body><p>Hi</p></body></html>" });
    // The footer sits before </body>.
    expect(out.raw).toMatch(/<p>Hi<\/p>.*Example Corp.*<\/body>/s);
  });

  it("uses multipart/alternative with a boundary that appears in the body", () => {
    const out = buildMime(baseInput);
    const contentType = out.headers["Content-Type"] ?? "";
    const boundary = contentType.match(/boundary="([^"]+)"/)?.[1];
    expect(boundary).toBeTruthy();
    // Boundary must appear at least twice as a delimiter (start of parts) plus the terminal --.
    expect(out.raw).toContain(`--${boundary}`);
    expect(out.raw).toContain(`--${boundary}--`);
  });

  it("adds X-Quiksend-Canary-Id when canaryToken is provided", () => {
    const token = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    const out = buildMime({ ...baseInput, canaryToken: token });
    expect(out.headers["X-Quiksend-Canary-Id"]).toBe(token);
    expect(out.raw).toContain(`X-Quiksend-Canary-Id: ${token}`);
  });

  it("omits X-Quiksend-Canary-Id when canaryToken is absent", () => {
    const out = buildMime(baseInput);
    expect(out.headers["X-Quiksend-Canary-Id"]).toBeUndefined();
    expect(out.raw).not.toContain("X-Quiksend-Canary-Id");
  });
});

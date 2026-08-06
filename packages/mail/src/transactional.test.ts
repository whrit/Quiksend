/**
 * Tests lazy transport creation and sendMail passthrough; mocks nodemailer
 * like smtp.test.ts. `sendTransactionalEmail` is re-imported fresh (via
 * `vi.resetModules()` + dynamic `import()`) before every case in the
 * `sendTransactionalEmail` describe block — production memoizes the
 * transport on purpose (see transactional.ts), but that means each test here
 * would otherwise inherit whatever transport a prior case already built,
 * making `createTransport`-call assertions depend on run order. Resetting
 * the module registry gives each case its own unmemoized module instance
 * without touching the memoization behavior under test elsewhere.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sendMail, createTransport } = vi.hoisted(() => ({
  sendMail: vi.fn<(message: unknown) => Promise<{ messageId?: string }>>(),
  createTransport: vi.fn<() => { sendMail: unknown }>(),
}));
createTransport.mockImplementation(() => ({ sendMail }));

vi.mock("nodemailer", () => ({ default: { createTransport } }));

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {
    SMTP_HOST: undefined as string | undefined,
    SMTP_PORT: undefined as number | undefined,
    SMTP_FROM: undefined as string | undefined,
    SMTP_FROM_NAME: undefined as string | undefined,
    SMTP_USER: undefined as string | undefined,
    SMTP_PASS: undefined as string | undefined,
    SMTP_SECURE: false,
    SMTP_REQUIRE_TLS: false,
  },
}));

vi.mock("@quiksend/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@quiksend/config")>();
  return {
    ...actual,
    env: {
      ...actual.env,
      get SMTP_HOST() {
        return mockEnv.SMTP_HOST;
      },
      get SMTP_PORT() {
        return mockEnv.SMTP_PORT;
      },
      get SMTP_FROM() {
        return mockEnv.SMTP_FROM;
      },
      get SMTP_FROM_NAME() {
        return mockEnv.SMTP_FROM_NAME;
      },
      get SMTP_USER() {
        return mockEnv.SMTP_USER;
      },
      get SMTP_PASS() {
        return mockEnv.SMTP_PASS;
      },
      get SMTP_SECURE() {
        return mockEnv.SMTP_SECURE;
      },
      get SMTP_REQUIRE_TLS() {
        return mockEnv.SMTP_REQUIRE_TLS;
      },
    },
  };
});

describe("sendTransactionalEmail", () => {
  let sendTransactionalEmail: (typeof import("./transactional.ts"))["sendTransactionalEmail"];

  beforeEach(async () => {
    mockEnv.SMTP_HOST = "localhost";
    mockEnv.SMTP_PORT = 1025;
    mockEnv.SMTP_FROM = undefined;
    mockEnv.SMTP_FROM_NAME = undefined;
    mockEnv.SMTP_USER = undefined;
    mockEnv.SMTP_PASS = undefined;
    mockEnv.SMTP_SECURE = false;
    mockEnv.SMTP_REQUIRE_TLS = false;
    sendMail.mockResolvedValue({ messageId: "<id@relay>" });
    // Fresh module instance per test — see file header — so this test's
    // `transport` memoization starts unset regardless of what earlier tests
    // built.
    vi.resetModules();
    ({ sendTransactionalEmail } = await import("./transactional.ts"));
  });

  afterEach(() => {
    sendMail.mockReset();
    createTransport.mockClear();
  });

  it("throws instead of silently sending when no transactional SMTP relay is configured — proves the transport is lazy, not eagerly built", async () => {
    mockEnv.SMTP_HOST = undefined;
    await expect(
      sendTransactionalEmail({ to: "a@example.com", subject: "s", text: "t", html: "<p>t</p>" }),
    ).rejects.toThrow(/SMTP_HOST/);
    expect(createTransport).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("falls back to a dev-only *.local From address when SMTP_FROM is unset", async () => {
    await sendTransactionalEmail({
      to: "a@example.com",
      subject: "s",
      text: "t",
      html: "<p>t</p>",
    });
    expect(sendMail).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ from: expect.stringContaining("@quiksend.local") }),
    );
  });

  it("uses the configured SMTP_FROM / SMTP_FROM_NAME instead of the dev fallback", async () => {
    mockEnv.SMTP_FROM = "no-reply@quiksend.example";
    mockEnv.SMTP_FROM_NAME = "Quiksend Security";
    await sendTransactionalEmail({
      to: "a@example.com",
      subject: "s",
      text: "t",
      html: "<p>t</p>",
    });
    expect(sendMail).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ from: '"Quiksend Security" <no-reply@quiksend.example>' }),
    );
  });

  it("passes paired SMTP_USER/SMTP_PASS and the TLS posture through to the transport", async () => {
    mockEnv.SMTP_USER = "relay-user";
    mockEnv.SMTP_PASS = "relay-pass";
    mockEnv.SMTP_SECURE = true;
    mockEnv.SMTP_REQUIRE_TLS = true;
    await sendTransactionalEmail({
      to: "a@example.com",
      subject: "s",
      text: "t",
      html: "<p>t</p>",
    });
    expect(createTransport).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        secure: true,
        requireTLS: true,
        auth: { user: "relay-user", pass: "relay-pass" },
      }),
    );
  });

  it("sends via the operator relay (never a customer mailbox) and memoizes the transport across calls", async () => {
    await sendTransactionalEmail({
      to: "user@example.com",
      subject: "Reset your password",
      text: "plain body",
      html: "<p>html body</p>",
    });
    await sendTransactionalEmail({
      to: "second@example.com",
      subject: "Reset your password",
      text: "plain body",
      html: "<p>html body</p>",
    });
    expect(createTransport).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ host: "localhost", port: 1025, secure: false }),
    );
    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(sendMail).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        to: "user@example.com",
        subject: "Reset your password",
        text: "plain body",
        html: "<p>html body</p>",
      }),
    );
  });
});

describe("escapeHtml", () => {
  it("escapes the five HTML-significant characters", async () => {
    const { escapeHtml } = await import("./transactional.ts");
    expect(escapeHtml(`<script>alert('x')</script> & "quotes"`)).toBe(
      "&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; &quot;quotes&quot;",
    );
  });

  it("neutralizes a hostile organization name so it can't break out of an HTML attribute or inject a tag", async () => {
    const { escapeHtml } = await import("./transactional.ts");
    const hostileName = `Acme"><img src=x onerror=alert(1)>`;
    const escaped = escapeHtml(hostileName);
    expect(escaped).not.toContain("<img");
    expect(escaped).not.toContain('">');
    expect(escaped).toBe("Acme&quot;&gt;&lt;img src=x onerror=alert(1)&gt;");
  });

  it("leaves plain text untouched", async () => {
    const { escapeHtml } = await import("./transactional.ts");
    expect(escapeHtml("Acme Corp")).toBe("Acme Corp");
  });
});

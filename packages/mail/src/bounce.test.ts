import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseBounce } from "./bounce.ts";

const samplesDir = join(dirname(fileURLToPath(import.meta.url)), "bounce.samples");

interface BounceSampleExpectation {
  name: string;
  path: string;
  expected:
    | { isBounce: false }
    | {
        isBounce: true;
        type: "hard" | "soft";
        statusCode: string | null;
        recipient: string | null;
        provider: "gmail" | "microsoft" | "smtp" | "unknown";
      };
}

const samples: BounceSampleExpectation[] = [
  {
    name: "bounce-01-gmail-user-unknown",
    path: join(samplesDir, "bounce-01-gmail-user-unknown.eml"),
    expected: {
      isBounce: true,
      type: "hard",
      statusCode: "5.1.1",
      recipient: "baduser@nonexistent-domain-xyz.com",
      provider: "gmail",
    },
  },
  {
    name: "bounce-02-gmail-over-quota",
    path: join(samplesDir, "bounce-02-gmail-over-quota.eml"),
    expected: {
      isBounce: true,
      type: "soft",
      statusCode: "4.2.2",
      recipient: "fullbox@recipient.com",
      provider: "gmail",
    },
  },
  {
    name: "bounce-03-gmail-spam-blocked",
    path: join(samplesDir, "bounce-03-gmail-spam-blocked.eml"),
    expected: {
      isBounce: true,
      type: "hard",
      statusCode: "5.7.1",
      recipient: "blocked@recipient.com",
      provider: "gmail",
    },
  },
  {
    name: "bounce-04-microsoft-ndr-user-unknown",
    path: join(samplesDir, "bounce-04-microsoft-ndr-user-unknown.eml"),
    expected: {
      isBounce: true,
      type: "hard",
      statusCode: "5.1.1",
      recipient: "unknown@bad-domain-abc.com",
      provider: "microsoft",
    },
  },
  {
    name: "bounce-05-microsoft-ndr-mx-config",
    path: join(samplesDir, "bounce-05-microsoft-ndr-mx-config.eml"),
    expected: {
      isBounce: true,
      type: "soft",
      statusCode: "4.4.4",
      recipient: "admin@misconfigured-mx.com",
      provider: "microsoft",
    },
  },
  {
    name: "bounce-06-generic-smtp-550",
    path: join(samplesDir, "bounce-06-generic-smtp-550.eml"),
    expected: {
      isBounce: true,
      type: "hard",
      statusCode: "5.1.1",
      recipient: "rejected@invalid-domain.net",
      provider: "smtp",
    },
  },
  {
    name: "bounce-07-generic-smtp-452",
    path: join(samplesDir, "bounce-07-generic-smtp-452.eml"),
    expected: {
      isBounce: true,
      type: "soft",
      statusCode: "4.2.2",
      recipient: "quota@recipient.net",
      provider: "smtp",
    },
  },
  {
    name: "bounce-08-postfix-double-bounce",
    path: join(samplesDir, "bounce-08-postfix-double-bounce.eml"),
    expected: {
      isBounce: true,
      type: "hard",
      statusCode: "5.4.6",
      recipient: "mailer-daemon@mail.example.org",
      provider: "smtp",
    },
  },
  {
    name: "bounce-09-not-bounce-auto-reply",
    path: join(samplesDir, "bounce-09-not-bounce-auto-reply.eml"),
    expected: { isBounce: false },
  },
  {
    name: "bounce-10-not-bounce-vacation-ooo",
    path: join(samplesDir, "bounce-10-not-bounce-vacation-ooo.eml"),
    expected: { isBounce: false },
  },
  {
    name: "bounce-11-not-bounce-legitimate-reply",
    path: join(samplesDir, "bounce-11-not-bounce-legitimate-reply.eml"),
    expected: { isBounce: false },
  },
  {
    name: "bounce-12-gmail-no-such-user",
    path: join(samplesDir, "bounce-12-gmail-no-such-user.eml"),
    expected: {
      isBounce: true,
      type: "hard",
      statusCode: "5.1.1",
      recipient: "noexist@example.org",
      provider: "gmail",
    },
  },
  {
    name: "bounce-13-microsoft-mailbox-not-found",
    path: join(samplesDir, "bounce-13-microsoft-mailbox-not-found.eml"),
    expected: {
      isBounce: true,
      type: "hard",
      statusCode: "5.1.10",
      recipient: "bounced@contoso.com",
      provider: "microsoft",
    },
  },
  {
    name: "bounce-14-rfc3464-dsn-hard",
    path: join(samplesDir, "bounce-14-rfc3464-dsn-hard.eml"),
    expected: {
      isBounce: true,
      type: "hard",
      statusCode: "5.1.1",
      recipient: "invalid-user@relay.test",
      provider: "unknown",
    },
  },
  {
    name: "bounce-15-rfc3464-dsn-soft",
    path: join(samplesDir, "bounce-15-rfc3464-dsn-soft.eml"),
    expected: {
      isBounce: true,
      type: "soft",
      statusCode: "4.3.0",
      recipient: "busy@relay.test",
      provider: "unknown",
    },
  },
];

const bounceSamples = samples.filter((s) => s.expected.isBounce);
const nonBounceSamples = samples.filter((s) => !s.expected.isBounce);

describe("parseBounce corpus", () => {
  it("loads every fixture file in bounce.samples", () => {
    const files = readdirSync(samplesDir).filter((f) => f.endsWith(".eml"));
    expect(files).toHaveLength(samples.length);
  });

  it.each(nonBounceSamples)("$name is not a bounce", (sample) => {
    const raw = readFileSync(sample.path, "utf8");
    expect(parseBounce(raw)).toBeNull();
  });

  it.each(bounceSamples)("$name", (sample) => {
    const raw = readFileSync(sample.path, "utf8");
    const parsed = parseBounce(raw);
    const expected = sample.expected;
    if (!expected.isBounce) return;

    expect(parsed).not.toBeNull();
    expect(parsed!.type).toBe(expected.type);
    expect(parsed!.statusCode).toBe(expected.statusCode);
    expect(parsed!.recipient).toBe(expected.recipient);
    expect(parsed!.provider).toBe(expected.provider);
    expect(typeof parsed!.diagnostic).toBe("string");
    expect(parsed!.diagnostic!.length).toBeGreaterThan(0);
  });
});

describe("parseBounce classification", () => {
  it("classifies 5.x status as hard without DSN part", () => {
    const raw = [
      "From: Mail Delivery Subsystem <mailer-daemon@mail.example.org>",
      "Subject: Undeliverable: test",
      "Content-Type: text/plain",
      "",
      "550 5.1.1 User unknown - no such user at example.com",
    ].join("\r\n");
    const parsed = parseBounce(raw);
    expect(parsed?.type).toBe("hard");
    expect(parsed?.statusCode).toBe("5.1.1");
  });

  it("classifies over quota text as soft without status code", () => {
    const raw = [
      "From: Mail Delivery Subsystem <mailer-daemon@mail.example.org>",
      "Subject: Undeliverable: test",
      "Content-Type: text/plain",
      "",
      "The mailbox is over quota and mailbox full.",
    ].join("\r\n");
    const parsed = parseBounce(raw);
    expect(parsed?.type).toBe("soft");
  });
});

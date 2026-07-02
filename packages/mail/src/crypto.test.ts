import { describe, expect, it } from "vitest";
import { decryptSmtpConfig, encryptSmtpConfig, type SmtpConfigPlain } from "./crypto.ts";

const KEY = Buffer.alloc(32, 7).toString("base64");

const sample: SmtpConfigPlain = {
  host: "localhost",
  port: 1025,
  auth: { user: "u", pass: "p" },
  secure: false,
};

describe("encryptSmtpConfig / decryptSmtpConfig", () => {
  it("round-trips SMTP config", () => {
    const cipher = encryptSmtpConfig(sample, KEY);
    expect(decryptSmtpConfig(cipher, KEY)).toEqual(sample);
  });

  it("rejects tampered ciphertext (auth tag verification)", () => {
    const cipher = encryptSmtpConfig(sample, KEY);
    const buf = Buffer.from(cipher, "base64");
    const last = buf.at(-1);
    if (last === undefined) throw new Error("empty cipher");
    buf[buf.length - 1] = last ^ 0xff;
    const tampered = buf.toString("base64");
    expect(() => decryptSmtpConfig(tampered, KEY)).toThrow(/auth|decipher|tag/i);
  });

  it("rejects invalid key length", () => {
    expect(() => encryptSmtpConfig(sample, Buffer.alloc(16).toString("base64"))).toThrow(
      /32 bytes/,
    );
  });
});

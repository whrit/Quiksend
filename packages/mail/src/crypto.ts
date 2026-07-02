import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export interface SmtpConfigPlain {
  readonly host: string;
  readonly port: number;
  readonly auth?: { readonly user: string; readonly pass: string };
  readonly secure?: boolean;
}

/** AES-256-GCM encrypt → base64(nonce || tag || ciphertext). */
export function encryptSmtpConfig(plain: SmtpConfigPlain, keyBase64: string): string {
  const key = decodeKey(keyBase64);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, nonce);
  const plaintext = Buffer.from(JSON.stringify(plain), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([nonce, tag, ciphertext]).toString("base64");
}

/** Decrypt base64(nonce || tag || ciphertext) → plain SMTP config. */
export function decryptSmtpConfig(cipher: string, keyBase64: string): SmtpConfigPlain {
  const key = decodeKey(keyBase64);
  const buf = Buffer.from(cipher, "base64");
  if (buf.length < NONCE_BYTES + TAG_BYTES + 1) {
    throw new Error("Invalid SMTP config ciphertext");
  }
  const nonce = buf.subarray(0, NONCE_BYTES);
  const tag = buf.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES);
  const ciphertext = buf.subarray(NONCE_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, nonce);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8")) as SmtpConfigPlain;
}

function decodeKey(keyBase64: string): Buffer {
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) {
    throw new Error("MAILBOX_ENCRYPTION_KEY must decode to 32 bytes");
  }
  return key;
}

import { describe, expect, it } from "vitest";
import { validateImapHost } from "@quiksend/mail";

describe("createUserSeedInbox IMAP host validation", () => {
  it("rejects localhost", () => {
    expect(validateImapHost("localhost")).toMatch(/not allowed|security/i);
  });

  it("rejects RFC1918 addresses", () => {
    expect(validateImapHost("10.0.0.1")).toMatch(/private|not allowed/i);
    expect(validateImapHost("192.168.1.1")).toMatch(/private|not allowed/i);
    expect(validateImapHost("172.16.0.1")).toMatch(/private|not allowed/i);
  });

  it("rejects link-local and metadata endpoints", () => {
    expect(validateImapHost("169.254.169.254")).toMatch(/private|not allowed/i);
    expect(validateImapHost("169.254.1.1")).toMatch(/private|not allowed/i);
  });

  it("rejects .local and .internal hostnames", () => {
    expect(validateImapHost("mail.corp.local")).toMatch(/not allowed/i);
    expect(validateImapHost("imap.internal")).toMatch(/not allowed/i);
  });

  it("allows known public IMAP hosts", () => {
    expect(validateImapHost("imap.gmail.com")).toBeNull();
    expect(validateImapHost("outlook.office365.com")).toBeNull();
  });
});

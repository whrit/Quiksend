/**
 * Registry-level checks for the job schemas — every `JobName` must resolve to
 * a real zod schema, and the schemas that gate security-sensitive producers
 * (transactional mail) must actually reject malformed payloads, not just
 * pass through whatever the caller hands them.
 */
import { describe, expect, it } from "vitest";
import { JOB_NAMES, JobSchemas, mailSendTransactionalSchema } from "./jobs.ts";

describe("JobSchemas registry", () => {
  it("has a schema for every registered job name", () => {
    for (const name of JOB_NAMES) {
      expect(JobSchemas[name]).toBeDefined();
    }
  });

  it("includes mail.send_transactional", () => {
    expect(JOB_NAMES).toContain("mail.send_transactional");
    expect(JobSchemas["mail.send_transactional"]).toBe(mailSendTransactionalSchema);
  });
});

describe("mailSendTransactionalSchema", () => {
  const valid = {
    to: "invitee@example.com",
    subject: "You're invited to join Acme on Quiksend",
    text: "plain body",
    html: "<p>html body</p>",
  };

  it("accepts a well-formed transactional mail payload", () => {
    expect(mailSendTransactionalSchema.parse(valid)).toEqual(valid);
  });

  it("rejects an invalid recipient email", () => {
    expect(mailSendTransactionalSchema.safeParse({ ...valid, to: "not-an-email" }).success).toBe(
      false,
    );
  });

  it.each(["subject", "text", "html"] as const)("rejects an empty %s", (field) => {
    expect(mailSendTransactionalSchema.safeParse({ ...valid, [field]: "" }).success).toBe(false);
  });

  it("rejects a payload missing a required field", () => {
    const { html: _html, ...withoutHtml } = valid;
    expect(mailSendTransactionalSchema.safeParse(withoutHtml).success).toBe(false);
  });

  it("never requires (or permits mistaking) SMTP credentials in the payload shape", () => {
    // The schema's own keys are the payload's entire allowed surface for
    // callers reading types — this just documents that surface stays at
    // exactly {to, subject, text, html}.
    expect(Object.keys(mailSendTransactionalSchema.shape).sort()).toEqual([
      "html",
      "subject",
      "text",
      "to",
    ]);
  });
});

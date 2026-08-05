import { randomUUID } from "node:crypto";
import type {
  IdentityHealth,
  MailboxAdapter,
  OutboundEmail,
  SendResult,
} from "../adapter.ts";

/**
 * In-memory adapter for unit tests. Records every send so tests can assert on
 * the payload — including threading headers, MIME shape, and idempotency keys.
 *
 * Never registered with the real registry; test code constructs directly.
 */
export interface FakeAdapterState {
  readonly sent: OutboundEmail[];
  identity: IdentityHealth;
}

export function createFakeAdapter(initial?: Partial<FakeAdapterState>): {
  adapter: MailboxAdapter;
  state: FakeAdapterState;
} {
  const state: FakeAdapterState = {
    sent: [...(initial?.sent ?? [])],
    identity: initial?.identity ?? {
      domain: "example.com",
      spf: { pass: true, reason: null },
      dkim: { pass: true, reason: null },
      dmarc: { pass: true, reason: null },
      checkedAt: new Date(),
    },
  };

  const adapter: MailboxAdapter = {
    provider: "smtp",
    async send(input: OutboundEmail): Promise<SendResult> {
      state.sent.push(input);
      const providerMessageId = randomUUID();
      return {
        messageId: `<${providerMessageId}@fake>`,
        providerMessageId,
        providerThreadId: input.threading?.providerThreadId ?? null,
        sentAt: new Date(),
        metadataReconciled: true,
      };
    },
    async verifyIdentity(): Promise<IdentityHealth> {
      return state.identity;
    },
  };

  return { adapter, state };
}

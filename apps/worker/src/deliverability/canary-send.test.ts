import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const buildMimeMock = vi.fn<(input: { html: string }) => { raw: string; html: string }>();
const sendMimeMock = vi.fn<() => Promise<void>>();

vi.mock("@quiksend/mail", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@quiksend/mail")>();
  return {
    ...actual,
    buildMime: (...args: unknown[]) => buildMimeMock(...(args as [{ html: string }])),
    sendMime: (...args: unknown[]) => sendMimeMock(...(args as [])),
    createSmtpTransport: vi.fn<() => object>(() => ({})),
    mintUnsubscribeToken: vi.fn<() => string>(() => "test-token"),
    buildUnsubscribeUrl: vi.fn<() => string>(() => "https://app.example.com/unsub"),
    buildComplianceParts: vi.fn<() => { footerHtml: string; footerText: string }>(() => ({
      footerHtml: "",
      footerText: "",
    })),
  };
});

vi.mock("../sequence/mailbox-adapter.ts", () => ({
  createMailboxAdapter: vi.fn<() => { send: ReturnType<typeof vi.fn> }>(() => ({
    send: vi.fn<() => Promise<void>>(),
  })),
}));

vi.mock("../sequence/workspace-postal.ts", () => ({
  getWorkspacePostalAddress: vi.fn<() => Promise<string>>(async () => "123 Main St"),
}));

vi.mock("../sequence/render-template.ts", () => ({
  renderTemplate: vi.fn<(template: string) => string>((template) => template),
  stripHtml: vi.fn<(html: string) => string>((html) => html.replace(/<[^>]+>/g, "")),
}));

vi.mock("@quiksend/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@quiksend/config")>();
  return {
    ...actual,
    env: {
      ...actual.env,
      BETTER_AUTH_URL: "https://app.example.com",
      SMTP_HOST: "localhost",
      SMTP_PORT: 1025,
    },
  };
});

const dbMocks = vi.hoisted(() => ({
  canaryRow: null as Record<string, unknown> | null,
  sequence: null as Record<string, unknown> | null,
  mailbox: null as Record<string, unknown> | null,
  seedInbox: null as Record<string, unknown> | null,
  org: null as Record<string, unknown> | null,
  steps: [] as Record<string, unknown>[],
}));

vi.mock("@quiksend/db", () => ({
  db: {
    query: {
      canarySend: {
        findFirst: vi.fn<() => Promise<Record<string, unknown> | null>>(
          async () => dbMocks.canaryRow,
        ),
      },
      sequence: {
        findFirst: vi.fn<() => Promise<Record<string, unknown> | null>>(
          async () => dbMocks.sequence,
        ),
      },
      mailbox: {
        findFirst: vi.fn<() => Promise<Record<string, unknown> | null>>(
          async () => dbMocks.mailbox,
        ),
      },
      seedInbox: {
        findFirst: vi.fn<() => Promise<Record<string, unknown> | null>>(
          async () => dbMocks.seedInbox,
        ),
      },
      organization: {
        findFirst: vi.fn<() => Promise<Record<string, unknown> | null>>(async () => dbMocks.org),
      },
      sequenceStep: {
        findMany: vi.fn<() => Promise<Record<string, unknown>[]>>(async () => dbMocks.steps),
      },
    },
    update: vi.fn<() => { set: () => { where: () => Promise<void> } }>(() => ({
      set: vi.fn<() => { where: () => Promise<void> }>(() => ({
        where: vi.fn<() => Promise<void>>(async () => undefined),
      })),
    })),
    select: vi.fn<() => { from: ReturnType<typeof vi.fn> }>(() => ({
      from: vi.fn<() => { where: ReturnType<typeof vi.fn> }>(() => ({
        where: vi.fn<() => Promise<Array<{ count: number }>>>(async () => [{ count: 0 }]),
      })),
    })),
  },
  tables: {
    canarySend: { id: "id", organizationId: "organizationId", sentAt: "sentAt" },
    sequence: { id: "id", organizationId: "organizationId" },
    mailbox: { id: "id", organizationId: "organizationId" },
    seedInbox: { id: "id" },
    organization: { id: "id" },
    sequenceStep: { sequenceId: "sequenceId", organizationId: "organizationId" },
    sendReservation: {
      mailboxId: "mailboxId",
      recipientDomain: "recipientDomain",
      reservedAt: "reservedAt",
      status: "status",
    },
  },
}));

vi.mock("@quiksend/queue", () => ({
  enqueue: vi.fn<() => Promise<void>>(),
}));

import { materializeCanarySend } from "./canary-send.ts";

describe("materializeCanarySend sanitizer parity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const canaryId = randomUUID();
    const token = randomUUID();
    dbMocks.canaryRow = {
      id: canaryId,
      organizationId: "org-1",
      sequenceId: randomUUID(),
      mailboxId: randomUUID(),
      seedInboxId: randomUUID(),
      canaryToken: token,
      stepIndex: 0,
      sentAt: null,
    };
    dbMocks.sequence = {
      id: dbMocks.canaryRow.sequenceId,
      organizationId: "org-1",
      name: "Test Seq",
      canaryConfig: {},
    };
    dbMocks.mailbox = {
      id: dbMocks.canaryRow.mailboxId,
      organizationId: "org-1",
      provider: "smtp",
      address: "sender@example.com",
      fromName: "Sender",
      signatureHtml: null,
    };
    dbMocks.seedInbox = {
      id: dbMocks.canaryRow.seedInboxId,
      email: "seed@proofpoint-customer.com",
      gateway: "proofpoint",
      active: true,
    };
    dbMocks.org = {
      metadata: JSON.stringify({
        deliverability: {
          routingPolicy: "enforce",
          contentSanitizerEnabled: true,
        },
      }),
    };
    dbMocks.steps = [
      {
        stepIndex: 0,
        stepType: "auto_email",
        config: {
          subject: "Hello",
          body_template:
            '<p>Hi</p><img src="https://app.example.com/t/open/abc" width="1" height="1" />',
        },
      },
    ];
    buildMimeMock.mockImplementation((input) => ({
      raw: `html:${input.html}`,
      html: input.html,
    }));
    sendMimeMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    delete process.env.TRACKING_PIXEL_DOMAIN;
  });

  it("strips tracking pixels for SEG seed inboxes when sanitizer policy is enabled", async () => {
    process.env.TRACKING_PIXEL_DOMAIN = "app.example.com";
    await materializeCanarySend(dbMocks.canaryRow!.id as string);

    expect(buildMimeMock).toHaveBeenCalled();
    const mimeInput = buildMimeMock.mock.calls[0]![0] as { html: string; text: string };
    expect(mimeInput.html).not.toMatch(/<img/i);
    expect(mimeInput.text).not.toMatch(/<img/i);
  });
});

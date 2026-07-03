import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const imapMocks = vi.hoisted(() => ({
  fetchOne: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  search: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  connect: vi.fn<() => Promise<void>>(async () => undefined),
  logout: vi.fn<() => Promise<void>>(async () => undefined),
  getMailboxLock: vi.fn<() => Promise<{ release: () => void }>>(async () => ({
    release: vi.fn<() => void>(),
  })),
}));

vi.mock("imapflow", () => ({
  ImapFlow: class MockImapFlow {
    connect = imapMocks.connect;
    logout = imapMocks.logout;
    getMailboxLock = imapMocks.getMailboxLock;
    search = imapMocks.search;
    fetchOne = imapMocks.fetchOne;
  },
}));

import {
  classifyArrivalFolder,
  extractCanaryToken,
  folderToStatus,
  isBounceMessage,
  searchCanaryMessages,
} from "./seed-imap.ts";

describe("classifyArrivalFolder", () => {
  it("maps inbox folders", () => {
    expect(classifyArrivalFolder("INBOX")).toBe("inbox");
    expect(classifyArrivalFolder("[Gmail]/Inbox")).toBe("inbox");
  });

  it("maps spam and junk folders", () => {
    expect(classifyArrivalFolder("Spam")).toBe("spam");
    expect(classifyArrivalFolder("Junk E-mail")).toBe("spam");
  });

  it("maps quarantine and clutter folders", () => {
    expect(classifyArrivalFolder("Quarantine")).toBe("quarantine");
    expect(classifyArrivalFolder("Clutter")).toBe("quarantine");
  });

  it("returns not_found for unrecognized folder names", () => {
    expect(classifyArrivalFolder("Archive")).toBe("not_found");
    expect(classifyArrivalFolder("RandomFolder")).toBe("not_found");
  });
});

describe("extractCanaryToken", () => {
  const token = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const known = new Set([token]);

  it("reads X-Quiksend-Canary-Id header", () => {
    const raw = `X-Quiksend-Canary-Id: ${token}\r\n\r\nbody`;
    expect(extractCanaryToken(raw, known)).toBe(token);
  });

  it("reads token from In-Reply-To", () => {
    const raw = `In-Reply-To: <${token}@quiksend.local>\r\n\r\n`;
    expect(extractCanaryToken(raw, known)).toBe(token);
  });

  it("reads token from References", () => {
    const raw = `References: <msg@x> <${token}@quiksend.local>\r\n\r\n`;
    expect(extractCanaryToken(raw, known)).toBe(token);
  });

  it("reads token from bounce body text", () => {
    const raw = `Content-Type: multipart/report\r\n\r\nFailed for ${token}`;
    expect(extractCanaryToken(raw, known)).toBe(token);
  });
});

describe("isBounceMessage", () => {
  it("detects multipart/report NDR", () => {
    expect(
      isBounceMessage({ "Content-Type": "multipart/report; report-type=delivery-status" }),
    ).toBe(true);
  });

  it("detects auto-replied bounces", () => {
    expect(isBounceMessage({ "Auto-Submitted": "auto-replied" })).toBe(true);
  });

  it("detects empty return-path bounces", () => {
    expect(isBounceMessage({ "Return-Path": "<>" })).toBe(true);
  });
});

describe("folderToStatus", () => {
  it("maps folder classes to arrival status", () => {
    expect(folderToStatus("inbox")).toBe("arrived_inbox");
    expect(folderToStatus("spam")).toBe("arrived_spam");
    expect(folderToStatus("quarantine")).toBe("arrived_quarantine");
  });

  it("maps bounce heuristics to bounced", () => {
    expect(folderToStatus("inbox", { isBounce: true })).toBe("bounced");
  });
});

describe("searchCanaryMessages header targeting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.QUIKSEND_CANARY_IMAP_MOCK;
  });

  afterEach(() => {
    delete process.env.QUIKSEND_CANARY_IMAP_MOCK;
  });

  it("fetches only matching canary UIDs instead of full inbox scan", async () => {
    const tokens = [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
    ];

    imapMocks.search.mockImplementation(async (...args: unknown[]) => {
      const query = args[0] as { header?: Record<string, string> };
      const token = query.header?.["X-Quiksend-Canary-Id"];
      if (token === tokens[0]) return [10];
      if (token === tokens[1]) return [20];
      if (token === tokens[2]) return [30];
      return [];
    });

    imapMocks.fetchOne.mockImplementation(async (...args: unknown[]) => {
      const uid = args[0] as string;
      const index = Number(uid) / 10 - 1;
      return {
        uid: Number(uid),
        headers: new Map([["X-Quiksend-Canary-Id", tokens[index]!]]),
      };
    });

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const found = await searchCanaryMessages(
      { host: "imap.test", port: 993, secure: true, auth: { user: "u", pass: "p" } },
      tokens,
      since,
    );

    expect(found.size).toBe(3);
    expect(imapMocks.fetchOne).toHaveBeenCalledTimes(3);
    expect(imapMocks.search).toHaveBeenCalled();
  });
});

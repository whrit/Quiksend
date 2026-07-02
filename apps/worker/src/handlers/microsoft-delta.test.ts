import { describe, expect, it } from "vitest";
import {
  MS_DELTA_PAGE_CAP,
  dedupeGraphMessages,
  filterMessagesSince,
  graphEndpointFromDeltaLink,
  type GraphDeltaPage,
} from "./microsoft-delta.ts";

describe("graphEndpointFromDeltaLink", () => {
  it("returns inbox delta path when no cursor link is stored", () => {
    expect(graphEndpointFromDeltaLink()).toBe("/v1.0/me/mailFolders/inbox/messages/delta");
  });

  it("strips the Graph host from stored delta links", () => {
    expect(
      graphEndpointFromDeltaLink(
        "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=abc",
      ),
    ).toBe("/me/mailFolders/inbox/messages/delta?$deltatoken=abc");
  });
});

describe("dedupeGraphMessages", () => {
  it("removes duplicate provider ids across overlapping delta pages", () => {
    const items = [
      { id: "a", receivedDateTime: "2026-01-01T00:00:00Z" },
      { id: "b", receivedDateTime: "2026-01-02T00:00:00Z" },
      { id: "a", receivedDateTime: "2026-01-01T00:00:00Z" },
    ];
    expect(dedupeGraphMessages(items).map((item) => item.id)).toEqual(["a", "b"]);
  });
});

describe("microsoft delta pagination", () => {
  it("processes all pages until nextLink is exhausted", async () => {
    const pages: GraphDeltaPage[] = [
      {
        value: [{ id: "1", receivedDateTime: "2026-01-01T00:00:00Z" }],
        "@odata.nextLink":
          "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$skiptoken=page2",
      },
      {
        value: [{ id: "2", receivedDateTime: "2026-01-02T00:00:00Z" }],
        "@odata.nextLink":
          "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$skiptoken=page3",
      },
      {
        value: [{ id: "3", receivedDateTime: "2026-01-03T00:00:00Z" }],
        "@odata.deltaLink":
          "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=done",
      },
    ];

    const fetchedEndpoints: string[] = [];
    const collected: string[] = [];
    let endpoint = graphEndpointFromDeltaLink();
    let pageCount = 0;

    while (pageCount < MS_DELTA_PAGE_CAP) {
      fetchedEndpoints.push(endpoint);
      const page = pages[pageCount];
      if (!page) break;
      pageCount += 1;

      const since = new Date("2025-12-31T00:00:00Z");
      const deduped = dedupeGraphMessages([
        ...collected.map((id) => ({ id })),
        ...(page.value ?? []),
      ]);
      for (const item of filterMessagesSince(deduped, since)) {
        if (!collected.includes(item.id)) collected.push(item.id);
      }

      const nextLink = page["@odata.nextLink"];
      if (!nextLink) break;
      endpoint = graphEndpointFromDeltaLink(nextLink);
    }

    expect(pageCount).toBe(3);
    expect(collected).toEqual(["1", "2", "3"]);
    expect(fetchedEndpoints).toHaveLength(3);
  });
});

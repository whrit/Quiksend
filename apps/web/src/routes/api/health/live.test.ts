import { describe, it, expect } from "vitest";
import { Route } from "./live";

describe("Liveness Health Endpoint", () => {
  const handler = Route.server?.handlers?.GET;

  if (!handler) {
    throw new Error("Liveness handler not exported");
  }

  it("returns 200 with live status", async () => {
    const response = await handler({
      request: new Request("http://localhost/api/health/live"),
    } as never);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("live");
    expect(body.timestamp).toBeDefined();
    expect(typeof body.timestamp).toBe("string");
  });

  it("returns ISO timestamp", async () => {
    const response = await handler({
      request: new Request("http://localhost/api/health/live"),
    } as never);

    const body = await response.json();
    expect(() => new Date(body.timestamp)).not.toThrow();
  });

  it("returns 200 always (no dependencies checked)", async () => {
    // This endpoint does not call any dependencies,
    // so even if DB/queue were down, it would still return 200
    const response = await handler({
      request: new Request("http://localhost/api/health/live"),
    } as never);

    expect(response.status).toBe(200);
  });
});

import { describe, expect, it, vi } from "vitest";
import { ImapConnectionPool, type ImapPoolConnection } from "./imap-pool.ts";

function makeConn(seedInboxId: string): ImapPoolConnection {
  const touch = vi.fn<() => void>();
  const close = vi.fn<() => Promise<void>>(async () => undefined);
  return { seedInboxId, lastUsedAt: Date.now(), touch, close };
}

describe("ImapConnectionPool", () => {
  it("reuses connection within idle TTL", async () => {
    const pool = new ImapConnectionPool<ImapPoolConnection>({ idleTtlMs: 60_000 });
    const factory = vi.fn<() => Promise<ImapPoolConnection>>(async () => makeConn("seed-1"));

    const first = await pool.getOrCreate("seed-1", factory);
    const second = await pool.getOrCreate("seed-1", factory);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(first.touch).toHaveBeenCalled();
  });

  it("evicts stale connections after idle TTL", async () => {
    vi.useFakeTimers();
    const pool = new ImapConnectionPool<ImapPoolConnection>({ idleTtlMs: 1000 });
    const factory = vi.fn<() => Promise<ImapPoolConnection>>(async () => makeConn("seed-1"));

    const first = await pool.getOrCreate("seed-1", factory);
    vi.advanceTimersByTime(2000);
    await pool.evictStale();

    expect(first.close).toHaveBeenCalled();
    expect(pool.get("seed-1")).toBeUndefined();
    await pool.getOrCreate("seed-1", factory);
    expect(factory).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it("enforces max pool size by evicting oldest", async () => {
    const pool = new ImapConnectionPool<ImapPoolConnection>({ maxSize: 2, idleTtlMs: 60_000 });
    await pool.getOrCreate("a", async () => makeConn("a"));
    await new Promise((r) => setTimeout(r, 5));
    await pool.getOrCreate("b", async () => makeConn("b"));
    await pool.getOrCreate("c", async () => makeConn("c"));

    expect(pool.size).toBeLessThanOrEqual(2);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { raceWithTimeout, probeDatabase, probeQueue } from "./health.helpers";
import { getBoss } from "@quiksend/queue";

vi.mock("@quiksend/queue", () => ({
  getBoss: vi.fn<any>(),
}));

describe("Health Helpers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe("raceWithTimeout", () => {
    it("returns result when promise resolves before timeout", async () => {
      const promise = Promise.resolve("success");
      const result = raceWithTimeout(promise, 1000, "timeout");
      vi.advanceTimersByTime(500);
      await expect(result).resolves.toBe("success");
    });

    it("rejects when timeout fires", async () => {
      const promise = new Promise(() => {}); // Never resolves
      const result = raceWithTimeout(promise, 1000, "timeout message");
      vi.advanceTimersByTime(1000);
      await expect(result).rejects.toThrow("timeout message");
    });

    it("clears timeout on success (no timer leak)", async () => {
      const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");
      const promise = Promise.resolve("success");
      const result = raceWithTimeout(promise, 1000, "timeout");
      vi.advanceTimersByTime(500);
      await result;
      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    });

    it("clears timeout on rejection (no timer leak)", async () => {
      const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");
      const promise = Promise.reject(new Error("fail"));
      const result = raceWithTimeout(promise, 1000, "timeout");
      vi.advanceTimersByTime(500);
      await expect(result).rejects.toThrow("fail");
      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    });
  });

  describe("probeDatabase", () => {
    it("returns probe time on successful query", async () => {
      const mockClient = {
        execute: vi.fn<() => Promise<unknown>>().mockResolvedValue({ rows: [] }),
      };
      const result = probeDatabase(mockClient, 3000);
      const probeMs = await result;
      expect(probeMs).toBeGreaterThanOrEqual(0);
      expect(mockClient.execute).toHaveBeenCalledWith("SELECT NOW()");
    });

    it("fails when query timeout fires", async () => {
      const never = new Promise<never>(() => {}); // Never resolves — no resolver params used
      const mockClient = {
        execute: vi.fn<() => Promise<unknown>>().mockImplementation(() => never),
      };
      const result = probeDatabase(mockClient, 3000);
      vi.advanceTimersByTime(3000);
      await expect(result).rejects.toThrow("DB probe timeout after 3000ms");
    });

    it("fails when query rejects", async () => {
      const mockClient = {
        execute: vi.fn<() => Promise<unknown>>().mockRejectedValue(new Error("Connection refused")),
      };
      const result = probeDatabase(mockClient, 3000);
      vi.advanceTimersByTime(100);
      await expect(result).rejects.toThrow("Connection refused");
    });
  });

  describe("probeQueue", () => {
    it("returns probe time when queue is healthy", async () => {
      const mockBoss = {
        getQueue: vi.fn<() => Promise<unknown>>().mockResolvedValue({ name: "health.reconcile" }),
      };
      vi.mocked(getBoss).mockResolvedValue(mockBoss as never);

      const result = probeQueue(2000);
      vi.advanceTimersByTime(100);
      const probeMs = await result;
      expect(probeMs).toBeGreaterThanOrEqual(100);
      expect(mockBoss.getQueue).toHaveBeenCalledWith("health.reconcile");
    });

    it("fails when getQueue timeout fires", async () => {
      const never = new Promise<never>(() => {}); // Never resolves — no resolver params used
      const mockBoss = {
        getQueue: vi.fn<() => Promise<unknown>>().mockImplementation(() => never),
      };
      vi.mocked(getBoss).mockResolvedValue(mockBoss as never);

      const result = probeQueue(2000);
      // Race's losing promise leaks its rejection through the fake-timer event
      // loop after settlement — attach a no-op handler so vitest doesn't flag it.
      result.catch(() => undefined);
      await vi.advanceTimersByTimeAsync(2000);
      await expect(result).rejects.toThrow("Queue probe timeout after 2000ms");
    });

    it("fails when getBoss throws", async () => {
      vi.mocked(getBoss).mockRejectedValue(new Error("Boss initialization failed"));

      const result = probeQueue(2000);
      vi.advanceTimersByTime(100);
      await expect(result).rejects.toThrow("Boss initialization failed");
    });
  });
});

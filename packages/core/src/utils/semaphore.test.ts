import { describe, expect, it } from "vitest";
import { Semaphore } from "./semaphore.ts";

describe("Semaphore", () => {
  it("limits concurrent executions", async () => {
    const sem = new Semaphore(2);
    let inFlight = 0;
    let maxSeen = 0;

    const task = async () => {
      inFlight++;
      maxSeen = Math.max(maxSeen, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight--;
    };

    await Promise.all([sem.acquire(task), sem.acquire(task), sem.acquire(task), sem.acquire(task)]);

    expect(maxSeen).toBeLessThanOrEqual(2);
    expect(inFlight).toBe(0);
  });

  it("reaches full concurrency again after a burst larger than max", async () => {
    const sem = new Semaphore(2);
    let inFlight = 0;
    let maxSeen = 0;

    const task = async () => {
      inFlight++;
      maxSeen = Math.max(maxSeen, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
    };

    await Promise.all(Array.from({ length: 6 }, () => sem.acquire(task)));

    expect(maxSeen).toBe(2);
    expect(inFlight).toBe(0);
  });
});

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
});

/**
 * Limits concurrent async work to `max` in-flight tasks.
 * Used for IMAP polling and DNS lookups without external deps.
 */
export class Semaphore {
  private inFlight = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly max: number) {
    if (max < 1) throw new Error("Semaphore max must be at least 1");
  }

  async acquire<T>(fn: () => Promise<T>): Promise<T> {
    await this.waitForSlot();
    try {
      return await fn();
    } finally {
      this.releaseSlot();
    }
  }

  private waitForSlot(): Promise<void> {
    if (this.inFlight < this.max) {
      this.inFlight++;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waiters.push(() => {
        this.inFlight++;
        resolve();
      });
    });
  }

  private releaseSlot(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
    } else {
      this.inFlight--;
    }
  }
}

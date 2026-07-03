const IDLE_TTL_MS = 15 * 60 * 1000;
const MAX_POOL_SIZE = 20;

export interface ImapPoolConnection {
  readonly seedInboxId: string;
  readonly lastUsedAt: number;
  touch(): void;
}

interface PoolSlot<T extends ImapPoolConnection> {
  connection: T;
  lastUsedAt: number;
}

/**
 * Per-seed IMAP connection pool with idle TTL (CR-25).
 * OMICRON's seed-imap.ts should acquire via getOrCreate and call touch() on use.
 */
export class ImapConnectionPool<T extends ImapPoolConnection> {
  private readonly slots = new Map<string, PoolSlot<T>>();
  private readonly idleTtlMs: number;
  private readonly maxSize: number;

  constructor(options?: { idleTtlMs?: number; maxSize?: number }) {
    this.idleTtlMs = options?.idleTtlMs ?? IDLE_TTL_MS;
    this.maxSize = options?.maxSize ?? MAX_POOL_SIZE;
  }

  get(seedInboxId: string): T | undefined {
    this.evictStale();
    const slot = this.slots.get(seedInboxId);
    if (!slot) return undefined;
    slot.lastUsedAt = Date.now();
    slot.connection.touch();
    return slot.connection;
  }

  async getOrCreate(seedInboxId: string, factory: () => Promise<T>): Promise<T> {
    this.evictStale();
    const existing = this.slots.get(seedInboxId);
    if (existing) {
      existing.lastUsedAt = Date.now();
      existing.connection.touch();
      return existing.connection;
    }

    if (this.slots.size >= this.maxSize) {
      this.evictOldest();
    }

    const connection = await factory();
    this.slots.set(seedInboxId, { connection, lastUsedAt: Date.now() });
    return connection;
  }

  /** Idle heartbeat — extend TTL without performing IMAP work. */
  touch(seedInboxId: string): void {
    const slot = this.slots.get(seedInboxId);
    if (slot) {
      slot.lastUsedAt = Date.now();
      slot.connection.touch();
    }
  }

  release(seedInboxId: string): void {
    this.touch(seedInboxId);
  }

  evictStale(now = Date.now()): void {
    for (const [seedInboxId, slot] of this.slots) {
      if (now - slot.lastUsedAt > this.idleTtlMs) {
        this.slots.delete(seedInboxId);
      }
    }
  }

  private evictOldest(): void {
    let oldestId: string | undefined;
    let oldestAt = Number.POSITIVE_INFINITY;
    for (const [seedInboxId, slot] of this.slots) {
      if (slot.lastUsedAt < oldestAt) {
        oldestAt = slot.lastUsedAt;
        oldestId = seedInboxId;
      }
    }
    if (oldestId) this.slots.delete(oldestId);
  }

  get size(): number {
    return this.slots.size;
  }
}

/** Shared worker pool instance for seed IMAP polling. */
export const seedImapPool = new ImapConnectionPool<ImapPoolConnection>();

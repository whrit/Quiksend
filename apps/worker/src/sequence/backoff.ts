/** pg-boss-aligned backoff schedule: 60s → 5m → 30m → 3h → 12h */
const BACKOFF_SECONDS = [60, 300, 1800, 10_800, 43_200] as const;

export function backoffMs(retryCount: number): number {
  const index = Math.min(retryCount, BACKOFF_SECONDS.length - 1);
  return (BACKOFF_SECONDS[index] ?? 60) * 1000;
}

export function backoffUntil(retryCount: number, from: Date = new Date()): Date {
  return new Date(from.getTime() + backoffMs(retryCount));
}

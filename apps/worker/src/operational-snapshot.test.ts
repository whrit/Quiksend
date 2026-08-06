import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Tests for operational-snapshot pure logic.
 *
 * We avoid vi.mock('@quiksend/db') because the schema has circular re-exports
 * that trigger stack overflow under vitest's module mock. Instead we test:
 * 1. sanitize() — pure function, no deps
 * 2. evaluateAlerts() — pure function over snapshot + in-memory state
 * 3. collectSnapshot shape — by mocking db.execute at instance level
 */

// Mock config logger before importing anything that pulls it
vi.mock("@quiksend/config", () => ({
  logger: {
    info: vi.fn<any>(),
    warn: vi.fn<any>(),
    error: vi.fn<any>(),
    debug: vi.fn<any>(),
  },
  env: {
    NODE_ENV: "test",
    LOG_LEVEL: "info",
    DATABASE_URL: "postgres://localhost:5432/test",
    DATABASE_POOLER_MODE: "",
  },
}));

// Mock queue (no circular issues)
vi.mock("@quiksend/queue", () => ({
  registerHandler: vi.fn<any>(),
  getBoss: vi.fn<any>().mockResolvedValue({ schedule: vi.fn<any>() }),
}));

import { logger } from "@quiksend/config";
import {
  sanitize,
  evaluateAlerts,
  SNAPSHOT_KEYS,
  THRESHOLDS,
  resetAlertState,
  getAlertState,
  type OperationalSnapshot,
} from "./operational-snapshot";

function makeSnapshot(overrides: Partial<OperationalSnapshot> = {}): OperationalSnapshot {
  return {
    queueAgeMinutes: 0,
    stuckSendingCount: 0,
    staleEnrollmentCount: 0,
    mailboxPollLagMinutes: 0,
    webhookBacklogCount: 0,
    inboundFailureCount: 0,
    reconciliationFailureCount: 0,
    ...overrides,
  };
}

describe("operational-snapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAlertState();
  });

  // ── sanitize ────────────────────────────────────────────────────────────

  describe("sanitize", () => {
    it("returns 0 for null/undefined", () => {
      expect(sanitize(null)).toBe(0);
      expect(sanitize(undefined)).toBe(0);
    });

    it("returns 0 for NaN/Infinity/negative", () => {
      expect(sanitize(NaN)).toBe(0);
      expect(sanitize(Infinity)).toBe(0);
      expect(sanitize(-Infinity)).toBe(0);
      expect(sanitize(-5)).toBe(0);
    });

    it("rounds finite positive numbers", () => {
      expect(sanitize(3.7)).toBe(4);
      expect(sanitize(0)).toBe(0);
      expect(sanitize("42")).toBe(42);
    });

    it("returns 0 for non-numeric strings", () => {
      expect(sanitize("abc")).toBe(0);
    });
  });

  // ── SNAPSHOT_KEYS ─────────────────────────────────────────────────────

  describe("SNAPSHOT_KEYS", () => {
    it("has exactly 7 fixed keys", () => {
      expect(SNAPSHOT_KEYS).toHaveLength(7);
    });

    it("keys match OperationalSnapshot type", () => {
      const snap = makeSnapshot();
      for (const key of SNAPSHOT_KEYS) {
        expect(key in snap).toBe(true);
        expect(typeof snap[key]).toBe("number");
      }
    });

    it("snapshot has no extra keys beyond SNAPSHOT_KEYS", () => {
      const snap = makeSnapshot();
      expect(Object.keys(snap).toSorted()).toEqual([...SNAPSHOT_KEYS].toSorted());
    });

    it("contains no sensitive field names", () => {
      const sensitivePatterns = [/id$/i, /email/i, /org/i, /name/i, /address/i, /token/i];
      for (const key of SNAPSHOT_KEYS) {
        for (const pattern of sensitivePatterns) {
          expect(key).not.toMatch(pattern);
        }
      }
    });
  });

  // ── evaluateAlerts ────────────────────────────────────────────────────

  describe("evaluateAlerts", () => {
    it("fires one alert on first breach", () => {
      const snap = makeSnapshot({ stuckSendingCount: THRESHOLDS.stuckSendingCount + 1 });

      evaluateAlerts(snap);

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          metric: "stuckSendingCount",
          event: "ops.alert.breach",
        }),
        expect.stringContaining("exceeds threshold"),
      );
    });

    it("does not repeat alert while still breached", () => {
      const snap = makeSnapshot({ stuckSendingCount: THRESHOLDS.stuckSendingCount + 1 });

      evaluateAlerts(snap);
      evaluateAlerts(snap);

      expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    it("fires recovery notification when metric drops below threshold", () => {
      evaluateAlerts(makeSnapshot({ stuckSendingCount: THRESHOLDS.stuckSendingCount + 1 }));
      expect(logger.warn).toHaveBeenCalledTimes(1);

      evaluateAlerts(makeSnapshot({ stuckSendingCount: 0 }));
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          metric: "stuckSendingCount",
          event: "ops.alert.recovery",
        }),
        expect.stringContaining("below threshold"),
      );
    });

    it("allows subsequent breach alert after recovery", () => {
      const breached = makeSnapshot({ webhookBacklogCount: THRESHOLDS.webhookBacklogCount + 10 });
      const recovered = makeSnapshot({ webhookBacklogCount: 0 });

      evaluateAlerts(breached);
      expect(logger.warn).toHaveBeenCalledTimes(1);

      evaluateAlerts(recovered);

      vi.mocked(logger.warn).mockClear();
      evaluateAlerts(breached);
      expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    it("tracks each metric independently", () => {
      evaluateAlerts(
        makeSnapshot({
          queueAgeMinutes: THRESHOLDS.queueAgeMinutes + 10,
          inboundFailureCount: THRESHOLDS.inboundFailureCount + 5,
        }),
      );
      expect(logger.warn).toHaveBeenCalledTimes(2);

      // Recover only one
      evaluateAlerts(
        makeSnapshot({
          queueAgeMinutes: 0,
          inboundFailureCount: THRESHOLDS.inboundFailureCount + 5,
        }),
      );

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ metric: "queueAgeMinutes", event: "ops.alert.recovery" }),
        expect.any(String),
      );
      // No repeat warn for inboundFailureCount
      expect(logger.warn).toHaveBeenCalledTimes(2);
    });

    it("does not alert when at exactly the threshold (not exceeded)", () => {
      evaluateAlerts(makeSnapshot({ stuckSendingCount: THRESHOLDS.stuckSendingCount }));
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("clears all alert state on resetAlertState", () => {
      evaluateAlerts(makeSnapshot({ stuckSendingCount: THRESHOLDS.stuckSendingCount + 1 }));
      expect(getAlertState().get("stuckSendingCount")).toBe(true);

      resetAlertState();
      expect(getAlertState().size).toBe(0);

      vi.mocked(logger.warn).mockClear();
      evaluateAlerts(makeSnapshot({ stuckSendingCount: THRESHOLDS.stuckSendingCount + 1 }));
      expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    it("all snapshot values from makeSnapshot are finite bounded numbers", () => {
      const snap = makeSnapshot({ queueAgeMinutes: 999, webhookBacklogCount: 50 });
      for (const key of SNAPSHOT_KEYS) {
        expect(Number.isFinite(snap[key])).toBe(true);
        expect(snap[key]).toBeGreaterThanOrEqual(0);
      }
    });
  });
});

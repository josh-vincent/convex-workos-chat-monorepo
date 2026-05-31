// Pure currency-status helpers (no Convex imports — easy to unit test).
// Computes the derived status of a register entry based on dates and review schedule.
// NEVER store the result — always recompute at query time.

export type CurrencyStatus =
  | "current"
  | "expiring_soon"
  | "expired"
  | "missing"
  | "review_due";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Derive the currency status of a register entry.
 *
 * Priority order (highest first):
 *   expired > expiring_soon > review_due > missing > current
 *
 * Rules:
 *  - "expired"       — expiresAt <= nowMs
 *  - "expiring_soon" — expiresAt is present and expiresAt - nowMs <= effectiveLeadDays * MS_PER_DAY
 *  - "review_due"    — reviewEveryDays is set AND issuedAt + reviewEveryDays * MS_PER_DAY <= nowMs
 *  - "missing"       — no expiresAt AND no reviewEveryDays AND (required ?? true)
 *  - "current"       — everything else (including required=false with no dates)
 */
export function currencyStatus(
  entry: {
    expiresAt?: number;
    issuedAt?: number;
    reviewEveryDays?: number;
    leadTimeDays?: number;
    required?: boolean;
  },
  nowMs: number,
  defaultLeadDays: number,
): CurrencyStatus {
  const { expiresAt, issuedAt, reviewEveryDays, leadTimeDays, required } = entry;

  // ── 1. expired ────────────────────────────────────────────────────────────
  if (expiresAt !== undefined && expiresAt <= nowMs) {
    return "expired";
  }

  // ── 2. expiring_soon ──────────────────────────────────────────────────────
  if (expiresAt !== undefined) {
    const effectiveLead = (leadTimeDays ?? defaultLeadDays) * MS_PER_DAY;
    if (expiresAt - nowMs <= effectiveLead) {
      return "expiring_soon";
    }
  }

  // ── 3. review_due ─────────────────────────────────────────────────────────
  if (reviewEveryDays !== undefined && issuedAt !== undefined) {
    if (issuedAt + reviewEveryDays * MS_PER_DAY <= nowMs) {
      return "review_due";
    }
  }

  // ── 4. missing ────────────────────────────────────────────────────────────
  // No expiry date tracked and no review cadence — entry has nothing to clock.
  // Treat as "missing" only when the entry is required (default: true).
  if (expiresAt === undefined && reviewEveryDays === undefined) {
    const isRequired = required ?? true;
    if (isRequired) {
      return "missing";
    }
  }

  // ── 5. current ────────────────────────────────────────────────────────────
  return "current";
}

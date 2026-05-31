// Pure retention helpers (no Convex imports — easy to unit test).
// Computes whether a record is past its statutory retention period.
// NEVER store the result — always recompute at deletion time.

const MS_PER_YEAR = 365 * 24 * 60 * 60 * 1000;

/** Default retention period in years when no config row exists. */
const DEFAULT_RETENTION_YEARS = 5;

/**
 * Resolve the retention period (in years) for a given record type and jurisdiction.
 *
 * Resolution order:
 *   1. configRows row matching exact jurisdiction and key "retention_years." + recordType
 *   2. configRows row matching "generic" and key "retention_years." + recordType
 *   3. Default: 5
 */
export function retentionYears(
  recordType: string,
  jurisdiction: string,
  configRows: Array<{ jurisdiction: string; key: string; value: unknown }>,
): number {
  const key = "retention_years." + recordType;

  // 1. Jurisdiction-specific match
  const specific = configRows.find(
    (r) => r.jurisdiction === jurisdiction && r.key === key,
  );
  if (specific !== undefined) {
    return specific.value as number;
  }

  // 2. Generic fallback
  const generic = configRows.find(
    (r) => r.jurisdiction === "generic" && r.key === key,
  );
  if (generic !== undefined) {
    return generic.value as number;
  }

  // 3. Hard default
  return DEFAULT_RETENTION_YEARS;
}

/**
 * Returns true when the record may be deleted (retention period has elapsed).
 *
 * Rules:
 *  - Anchor timestamp: completedAt takes precedence over createdAt.
 *  - If both are undefined: returns true (no retention anchor — allow delete).
 *  - years = 0: always true (no retention required).
 *  - Otherwise: true when nowMs >= anchor + years * MS_PER_YEAR.
 */
export function canDelete(
  record: { completedAt?: number; createdAt?: number },
  nowMs: number,
  years: number,
): boolean {
  if (years === 0) {
    return true;
  }

  const anchor = record.completedAt ?? record.createdAt;
  if (anchor === undefined) {
    return true;
  }

  return nowMs >= anchor + years * MS_PER_YEAR;
}

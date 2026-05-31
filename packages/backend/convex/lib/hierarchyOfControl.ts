/**
 * Hierarchy of Controls — pure helpers (no Convex imports).
 *
 * The hierarchy is ordered from strongest (index 0) to weakest (index 5).
 * Used by SWMS controlMeasure question answers to validate and compare
 * control levels (spec §9, DoD #7).
 */

/** All recognised control levels, ordered strongest → weakest. */
export const HIERARCHY: string[] = [
  "elimination",
  "substitution",
  "isolation",
  "engineering",
  "admin",
  "ppe",
];

/**
 * Returns the 0-based index of `level` in HIERARCHY, or -1 if unknown.
 * The lookup is case-sensitive.
 */
export function hierarchyRank(level: string): number {
  return HIERARCHY.indexOf(level);
}

/**
 * Returns true when `a` is at least as strong a control as `b`
 * (i.e. hierarchyRank(a) <= hierarchyRank(b)).
 * Returns false if either level is unknown (rank === -1).
 */
export function isStrongerOrEqual(a: string, b: string): boolean {
  const rankA = hierarchyRank(a);
  const rankB = hierarchyRank(b);
  if (rankA === -1 || rankB === -1) return false;
  return rankA <= rankB;
}

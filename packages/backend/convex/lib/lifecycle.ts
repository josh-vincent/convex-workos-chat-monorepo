/**
 * Pure lifecycle helpers for the inspection status machine (spec §5.2, §7).
 * No Convex imports — safe to unit-test without the Convex harness.
 */

export type InspectionStatus =
  | "scheduled"
  | "in_progress"
  | "submitted"
  | "completed"
  | "actions_open"
  | "closed"
  | "overdue";

/**
 * After an inspection completes, determine whether it moves to "actions_open"
 * (there are unresolved corrective actions) or straight to "closed".
 */
export function statusAfterComplete(
  hasOpenActions: boolean,
): "actions_open" | "closed" {
  return hasOpenActions ? "actions_open" : "closed";
}

/**
 * Allowed transition edges in the inspection lifecycle:
 *
 *   scheduled   → in_progress
 *   in_progress → submitted | completed
 *   submitted   → completed          (manager sign-off)
 *   completed   → actions_open | closed
 *   actions_open → closed
 *   scheduled   → overdue
 *   in_progress → overdue
 *
 * Everything else (including same→same) returns false.
 */
export function canTransition(from: string, to: string): boolean {
  const allowed: Record<string, string[]> = {
    scheduled: ["in_progress", "overdue"],
    in_progress: ["submitted", "completed", "overdue"],
    submitted: ["completed"],
    completed: ["actions_open", "closed"],
    actions_open: ["closed"],
  };

  const targets = allowed[from];
  if (!targets) return false;
  return targets.includes(to);
}

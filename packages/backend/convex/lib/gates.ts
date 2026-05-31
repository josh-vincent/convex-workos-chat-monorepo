// Pure gate-checking logic, shared between convex/gates.ts (query) and convex/jobs.ts (mutation).
// No Convex server imports — accepts a db-like context to keep it fully testable.
import { Id } from "../_generated/dataModel";
import { DatabaseReader } from "../_generated/server";
import { currencyStatus } from "./currency";

const SWMS_READY_STATUSES = new Set([
  "submitted",
  "completed",
  "closed",
  "actions_open",
]);

/** Returns true if the template key or category (case-insensitive) contains "swms". */
function isSwmsTemplate(template: { key: string; category: string }): boolean {
  return (
    template.key.toLowerCase().includes("swms") ||
    template.category.toLowerCase().includes("swms")
  );
}

export interface ReadinessResult {
  ok: boolean;
  blockers: string[];
}

/**
 * Core readiness check — shared between the query and the mutation.
 * Accepts any DatabaseReader (Convex QueryCtx or MutationCtx both expose ctx.db).
 */
export async function computeJobReadiness(
  db: DatabaseReader,
  jobId: Id<"jobs">,
  requiredEntryIds?: Id<"registerEntries">[],
): Promise<ReadinessResult> {
  const blockers: string[] = [];

  const job = await db.get(jobId);
  if (!job) {
    return { ok: false, blockers: ["Job not found"] };
  }

  // ── (a) SWMS gate ────────────────────────────────────────────────────────
  if (job.hrcw === true) {
    const anchored = await db
      .query("inspections")
      .withIndex("by_anchor", (q) =>
        q.eq("anchorType", "job").eq("anchorId", jobId),
      )
      .collect();

    let hasSignedSwms = false;
    for (const inspection of anchored) {
      if (!SWMS_READY_STATUSES.has(inspection.status)) continue;
      const signOffs = inspection.signOffs ?? [];
      if (signOffs.length === 0) continue;

      const template = await db.get(inspection.templateId);
      if (!template) continue;
      if (isSwmsTemplate(template)) {
        hasSignedSwms = true;
        break;
      }
    }

    if (!hasSignedSwms) {
      blockers.push("Signed SWMS required");
    }
  }

  // ── (b) Licence gate ─────────────────────────────────────────────────────
  if (requiredEntryIds && requiredEntryIds.length > 0) {
    const nowMs = Date.now();
    for (const entryId of requiredEntryIds) {
      const entry = await db.get(entryId);
      if (!entry) continue;
      const status = currencyStatus(entry, nowMs, 30);
      if (status === "expired") {
        blockers.push(`Expired licence: ${entry.label}`);
      }
    }
  }

  return { ok: blockers.length === 0, blockers };
}

/**
 * Look up "swms_gate_block" for a given jurisdiction (with "generic" fallback).
 * Returns true (hard block) by default when the config key is absent.
 */
export async function isSwmsGateHardBlock(
  db: DatabaseReader,
  jurisdiction: "vic_ohs" | "whs_harmonised" | "generic" | undefined,
): Promise<boolean> {
  const jur = jurisdiction ?? "generic";

  // Try the org's jurisdiction first.
  const exact = await db
    .query("jurisdictionConfigs")
    .withIndex("by_jurisdiction_key", (q) =>
      q.eq("jurisdiction", jur).eq("key", "swms_gate_block"),
    )
    .first();

  if (exact !== null) {
    return exact.value !== false;
  }

  // Fallback to generic.
  if (jur !== "generic") {
    const generic = await db
      .query("jurisdictionConfigs")
      .withIndex("by_jurisdiction_key", (q) =>
        q.eq("jurisdiction", "generic").eq("key", "swms_gate_block"),
      )
      .first();

    if (generic !== null) {
      return generic.value !== false;
    }
  }

  // Default: hard block.
  return true;
}

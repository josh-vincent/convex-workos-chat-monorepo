// Config-driven jurisdiction (spec §11, DoD #9).
//
// No hard-coded regulatory constants. All thresholds, windows and defaults live
// in the `jurisdictionConfigs` table and are looked up at runtime.
// "generic" is the fallback jurisdiction used when no jurisdiction-specific row exists.
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { jurisdictionUnion } from "./schema";

// ---------------------------------------------------------------------------
// Default rows inserted by seedDefaults
// ---------------------------------------------------------------------------

const DEFAULTS: Array<{
  jurisdiction: "vic_ohs" | "whs_harmonised" | "generic";
  key: string;
  value: unknown;
}> = [
  { jurisdiction: "vic_ohs", key: "principal_contractor_threshold", value: 350000 },
  { jurisdiction: "vic_ohs", key: "notifiable_incident_window_hours", value: 48 },
  { jurisdiction: "generic", key: "swms_review_default_days", value: 365 },
];

// ---------------------------------------------------------------------------
// seedDefaults — idempotent mutation
// ---------------------------------------------------------------------------

/**
 * Inserts the mandatory default jurisdiction config rows if they don't
 * already exist. Safe to call multiple times — it will never duplicate rows.
 */
export const seedDefaults = mutation({
  args: {},
  handler: async (ctx) => {
    for (const row of DEFAULTS) {
      const existing = await ctx.db
        .query("jurisdictionConfigs")
        .withIndex("by_jurisdiction_key", (q) =>
          q.eq("jurisdiction", row.jurisdiction).eq("key", row.key),
        )
        .first();

      if (!existing) {
        await ctx.db.insert("jurisdictionConfigs", row);
      }
    }
  },
});

// ---------------------------------------------------------------------------
// getThreshold — query with generic fallback
// ---------------------------------------------------------------------------

/**
 * Returns the configured value for (jurisdiction, key).
 *
 * Lookup order:
 *  1. The exact (jurisdiction, key) row.
 *  2. If not found AND jurisdiction !== "generic", fall back to ("generic", key).
 *  3. Return null if neither row exists.
 */
export const getThreshold = query({
  args: {
    jurisdiction: jurisdictionUnion,
    key: v.string(),
  },
  handler: async (ctx, { jurisdiction, key }) => {
    // 1. Exact match.
    const exact = await ctx.db
      .query("jurisdictionConfigs")
      .withIndex("by_jurisdiction_key", (q) =>
        q.eq("jurisdiction", jurisdiction).eq("key", key),
      )
      .first();

    if (exact !== null) {
      return exact.value as unknown;
    }

    // 2. Fallback to generic (only if not already querying generic).
    if (jurisdiction !== "generic") {
      const generic = await ctx.db
        .query("jurisdictionConfigs")
        .withIndex("by_jurisdiction_key", (q) =>
          q.eq("jurisdiction", "generic").eq("key", key),
        )
        .first();

      if (generic !== null) {
        return generic.value as unknown;
      }
    }

    // 3. Nothing found.
    return null;
  },
});

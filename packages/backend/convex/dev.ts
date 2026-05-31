// Dev / testing helpers. These operate ONLY on the seeded demo org ("northwind")
// so they're safe to expose in the template for repeated onboarding/QA runs.
import { mutation } from "./_generated/server";
import { scoreByOrg, scoreBySite } from "./components";

const DEMO_ORG_SLUG = "northwind";

/**
 * Clear all *activity* for the demo org so you can test the empty-state / onboarding
 * flow again: deletes inspections (and removes them from the score aggregates),
 * plus the records derived from them — actions, issues, and audit log.
 *
 * Keeps the org, your provisioned user/membership, sites, and the seeded templates.
 * Requires an authenticated caller.
 */
export const resetActivity = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const org = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", DEMO_ORG_SLUG))
      .unique();
    if (!org) {
      throw new Error(
        `Demo org "${DEMO_ORG_SLUG}" not seeded. Run: pnpm --filter @packages/backend seed`,
      );
    }

    // Inspections — drop each from the score aggregates before deleting the row,
    // otherwise dashboard averages/counts would keep counting deleted inspections.
    const inspections = await ctx.db
      .query("inspections")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .collect();
    for (const insp of inspections) {
      if (insp.score !== undefined) {
        await scoreByOrg.deleteIfExists(ctx, insp);
        await scoreBySite.deleteIfExists(ctx, insp);
      }
      await ctx.db.delete(insp._id);
    }

    // Derived activity (auto-created on completion).
    const deleteByOrg = async (table: "actions" | "issues" | "auditLog") => {
      const rows = await ctx.db
        .query(table)
        .withIndex("by_org", (q) => q.eq("orgId", org._id))
        .collect();
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length;
    };

    const cleared = {
      inspections: inspections.length,
      actions: await deleteByOrg("actions"),
      issues: await deleteByOrg("issues"),
      auditLog: await deleteByOrg("auditLog"),
    };

    return { ok: true, cleared };
  },
});

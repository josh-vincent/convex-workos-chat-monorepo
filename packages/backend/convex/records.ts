// Records queries — anchor graph feature (spec §2, §5.2, §8, DoD #8).
// Returns inspections linked to a given anchor (job/site/contract/person/asset).
// Also exposes tryDelete for statutory retention enforcement (spec §10, DoD #10-adjacent).
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { retentionYears, canDelete } from "./lib/retention";

const anchorTypeValidator = v.union(
  v.literal("job"),
  v.literal("site"),
  v.literal("contract"),
  v.literal("person"),
  v.literal("asset"),
);

/**
 * Attempt to delete an inspection, enforcing the statutory retention period.
 * Throws if the retention period has not elapsed.
 */
export const tryDelete = mutation({
  args: { inspectionId: v.id("inspections") },
  handler: async (ctx, { inspectionId }) => {
    const inspection = await ctx.db.get(inspectionId);
    if (!inspection) {
      throw new ConvexError("Inspection not found");
    }

    // Resolve the org's jurisdiction for config lookup
    const org = await ctx.db.get(inspection.orgId);
    const jurisdiction = org?.jurisdiction ?? "generic";

    // Fetch all jurisdictionConfigs rows
    const configRows = await ctx.db.query("jurisdictionConfigs").collect();

    // Resolve retention period
    const years = retentionYears("inspection", jurisdiction, configRows);

    // Check whether deletion is permitted
    const deletable = canDelete(
      { completedAt: inspection.completedAt, createdAt: inspection.startedAt },
      Date.now(),
      years,
    );

    if (!deletable) {
      throw new ConvexError(
        `Cannot delete: statutory retention period of ${years} year(s) has not elapsed.`,
      );
    }

    await ctx.db.delete(inspectionId);
    return { deleted: true };
  },
});

/** Return all inspections anchored to the given anchor type + id. */
export const byAnchor = query({
  args: {
    anchorType: anchorTypeValidator,
    anchorId: v.string(),
  },
  handler: async (ctx, { anchorType, anchorId }) => {
    return await ctx.db
      .query("inspections")
      .withIndex("by_anchor", (q) =>
        q.eq("anchorType", anchorType).eq("anchorId", anchorId),
      )
      .collect();
  },
});

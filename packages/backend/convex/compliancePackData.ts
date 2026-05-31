// convex/compliancePackData.ts -- internal helper queries for the compliancePack action.
// Must be in a separate non-"use node" file so it runs in the default Convex runtime.

import { internalQuery } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

/**
 * Resolve org name + anchor display name for the compliance pack cover page.
 * Returns { orgName, anchorName } -- both may be null if the record doesn't exist.
 */
export const resolveAnchor = internalQuery({
  args: {
    anchorType: v.union(
      v.literal("job"),
      v.literal("site"),
      v.literal("contract"),
      v.literal("person"),
      v.literal("asset"),
    ),
    anchorId: v.string(),
  },
  handler: async (ctx, { anchorType, anchorId }) => {
    // Derive org name from the first inspection tied to this anchor.
    const firstInsp = await ctx.db
      .query("inspections")
      .withIndex("by_anchor", (q) =>
        q.eq("anchorType", anchorType).eq("anchorId", anchorId),
      )
      .first();

    let orgName: string | null = null;
    if (firstInsp) {
      const org = await ctx.db.get(firstInsp.orgId);
      orgName = org?.name ?? null;
    }

    // Resolve anchor display name based on type using correct table lookups.
    let anchorName: string | null = null;

    if (anchorType === "site") {
      const row = await ctx.db.get(anchorId as Id<"sites">);
      anchorName = row?.name ?? null;
    } else if (anchorType === "job") {
      const row = await ctx.db.get(anchorId as Id<"jobs">);
      anchorName = row?.name ?? null;
    } else if (anchorType === "contract") {
      const row = await ctx.db.get(anchorId as Id<"contracts">);
      anchorName = row?.name ?? null;
    } else if (anchorType === "person") {
      const row = await ctx.db.get(anchorId as Id<"users">);
      anchorName = row?.name ?? null;
    } else if (anchorType === "asset") {
      const row = await ctx.db.get(anchorId as Id<"assets">);
      anchorName = row?.name ?? null;
    }

    return { orgName, anchorName };
  },
});

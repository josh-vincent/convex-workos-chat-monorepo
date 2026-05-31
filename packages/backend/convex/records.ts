// Records queries — anchor graph feature (spec §2, §5.2, §8, DoD #8).
// Returns inspections linked to a given anchor (job/site/contract/person/asset).
import { query } from "./_generated/server";
import { v } from "convex/values";

const anchorTypeValidator = v.union(
  v.literal("job"),
  v.literal("site"),
  v.literal("contract"),
  v.literal("person"),
  v.literal("asset"),
);

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

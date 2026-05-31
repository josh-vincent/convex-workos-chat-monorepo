import { query } from "./_generated/server";

/**
 * Resolve the seeded demo context (org + a default inspector). The React client uses this so it
 * has an orgId/inspectorId without an auth layer wired up yet.
 */
export const getDemo = query({
  args: {},
  handler: async (ctx) => {
    const org = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", "northwind"))
      .unique();
    if (!org) return null;
    const inspector = await ctx.db
      .query("users")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .first();
    return { org, inspectorId: inspector?._id ?? null };
  },
});

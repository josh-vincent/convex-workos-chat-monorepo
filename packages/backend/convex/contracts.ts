// Contracts — anchor graph feature (spec §2, §5.2, §8, DoD #8).
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/** Create a new contract. Returns the new contract id. */
export const create = mutation({
  args: {
    orgId: v.id("organizations"),
    name: v.string(),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("contracts", args);
  },
});

/** List all contracts for an org, ordered by creation time ascending. */
export const listByOrg = query({
  args: {
    orgId: v.id("organizations"),
  },
  handler: async (ctx, { orgId }) => {
    return await ctx.db
      .query("contracts")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("asc")
      .collect();
  },
});

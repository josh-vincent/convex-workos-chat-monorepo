// Job lifecycle functions — anchor graph feature (spec §2, §5.2, §8, DoD #8).
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/** Create a new job — defaults to "draft" status. Returns the new job id. */
export const create = mutation({
  args: {
    orgId: v.id("organizations"),
    name: v.string(),
    siteId: v.optional(v.id("sites")),
    hrcw: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("jobs", {
      ...args,
      status: "draft",
    });
  },
});

/** Get a job by id. Returns null if not found (also returns null for ids from other tables). */
export const get = query({
  args: { jobId: v.string() },
  handler: async (ctx, { jobId }) => {
    // Query the jobs table directly so cross-table ids (which return a row from a different
    // table via ctx.db.get) are excluded — only actual jobs rows match here.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await ctx.db
      .query("jobs")
      .filter((q) => q.eq(q.field("_id"), jobId))
      .unique();
  },
});

// Job lifecycle functions — anchor graph feature (spec §2, §5.2, §8, DoD #8).
import { ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { computeJobReadiness, isSwmsGateHardBlock } from "./lib/gates";

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

/**
 * Mark a job as ready to start.
 *
 * Reads the "swms_gate_block" jurisdiction config (default: true = hard block).
 *  - Hard block: throws if any gate blocker exists.
 *  - Soft gate: sets startedReady=true and returns { ok, blockers } even when blocked.
 */
export const markReady = mutation({
  args: {
    jobId: v.id("jobs"),
    requiredEntryIds: v.optional(v.array(v.id("registerEntries"))),
  },
  handler: async (ctx, { jobId, requiredEntryIds }) => {
    const { ok, blockers } = await computeJobReadiness(
      ctx.db,
      jobId,
      requiredEntryIds,
    );

    if (!ok) {
      // Look up the org's jurisdiction to find the gate setting.
      const job = await ctx.db.get(jobId);
      const org = job ? await ctx.db.get(job.orgId) : null;
      const hardBlock = await isSwmsGateHardBlock(ctx.db, org?.jurisdiction);

      if (hardBlock) {
        throw new ConvexError({ blockers, message: blockers.join("; ") });
      }

      // Soft gate — set ready anyway but return the blockers.
      await ctx.db.patch(jobId, { startedReady: true });
      return { ok: false, blockers };
    }

    await ctx.db.patch(jobId, { startedReady: true });
    return { ok: true, blockers: [] };
  },
});

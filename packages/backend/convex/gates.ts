// Workflow gates — enforce the right doc at the right moment (spec §8, §13, DoD #6).
//
// gates.jobReadiness: checks whether a job satisfies all pre-start gate conditions.
// Rules:
//   (a) SWMS gate — if job.hrcw === true, at least one inspection must be anchored
//       to the job (anchorType "job", anchorId = jobId) whose template key OR category
//       (lowercased) includes "swms", with status in (submitted|completed|closed|actions_open)
//       AND signOffs.length >= 1.
//   (b) Licence gate — for each Id in requiredEntryIds (if provided), fetch the
//       registerEntry and compute currencyStatus(). Any "expired" entry adds a blocker.
import { query } from "./_generated/server";
import { v } from "convex/values";
import { computeJobReadiness } from "./lib/gates";

export const jobReadiness = query({
  args: {
    jobId: v.id("jobs"),
    requiredEntryIds: v.optional(v.array(v.id("registerEntries"))),
  },
  handler: async (ctx, { jobId, requiredEntryIds }) => {
    return computeJobReadiness(ctx.db, jobId, requiredEntryIds);
  },
});

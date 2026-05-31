// Dashboard analytics backed by the Aggregate component — O(log n), no table scans.
// (Compare to inspections.list which collect()s; these stay cheap at thousands/org.)
import { query } from "./_generated/server";
import { v } from "convex/values";
import { scoreByOrg, scoreBySite } from "./components";

/** Org-wide KPIs: number of scored inspections + average safety score. */
export const orgScoreSummary = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    const count = await scoreByOrg.count(ctx, { namespace: orgId });
    if (count === 0) return { count: 0, averageScore: null };
    const total = await scoreByOrg.sum(ctx, { namespace: orgId });
    return { count, averageScore: Math.round(total / count) };
  },
});

/** Per-site average score — used for the "sites at risk" leaderboard on the dashboard. */
export const siteScoreSummary = query({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const count = await scoreBySite.count(ctx, { namespace: siteId });
    if (count === 0) return { count: 0, averageScore: null };
    const total = await scoreBySite.sum(ctx, { namespace: siteId });
    return { count, averageScore: Math.round(total / count) };
  },
});

/**
 * How many of an org's inspections scored at/above a threshold (pass rate), computed from
 * the aggregate's count-in-range — no scan. Returns { passed, total, rate }.
 */
export const orgPassRate = query({
  args: { orgId: v.id("organizations"), threshold: v.optional(v.number()) },
  handler: async (ctx, { orgId, threshold }) => {
    const cut = threshold ?? 90;
    const total = await scoreByOrg.count(ctx, { namespace: orgId });
    if (total === 0) return { passed: 0, total: 0, rate: null };
    const passed = await scoreByOrg.count(ctx, {
      namespace: orgId,
      bounds: { lower: { key: cut, inclusive: true } },
    });
    return { passed, total, rate: Math.round((passed / total) * 100) };
  },
});

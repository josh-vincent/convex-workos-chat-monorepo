// PLATFORM: cross-module views.
//
// The payoff of keeping the relational core as APP tables (not isolated components): a single
// person sees ONE unified inbox spanning every module, and one asset shows its full history.
// These reactive joins across modules are exactly what a component boundary would make awkward
// (Id<"table"> becomes an opaque string across a component) — so they live in the app layer.
import { query } from "./_generated/server";
import { v } from "convex/values";

/**
 * "My work" — every open task assigned to a person, across Safety, Maintenance, HR, Projects.
 * One list, regardless of which module raised the item (the `actions` table is shared).
 */
export const myInbox = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const tasks = await ctx.db
      .query("actions")
      .withIndex("by_assignee", (q) => q.eq("assigneeId", userId))
      .collect();
    const open = tasks.filter((t) => t.status !== "done");
    // Group by module so the UI can render per-module sections from one query.
    const byModule: Record<string, typeof open> = {};
    for (const t of open) {
      const m = t.module ?? "safety";
      (byModule[m] ??= []).push(t);
    }
    return { total: open.length, byModule };
  },
});

/**
 * Asset 360 — one asset's history pulled from MULTIPLE modules: safety inspections +
 * maintenance work orders. Possible because both reference the shared `assets` table.
 */
export const assetTimeline = query({
  args: { assetId: v.id("assets") },
  handler: async (ctx, { assetId }) => {
    const asset = await ctx.db.get(assetId);
    if (!asset) return null;
    const inspections = await ctx.db
      .query("inspections")
      .withIndex("by_template", (q) => q) // not asset-indexed; filter below (demo scale)
      .collect()
      .then((rows) => rows.filter((r) => r.assetId === assetId));
    const workOrders = await ctx.db
      .query("workOrders")
      .withIndex("by_asset", (q) => q.eq("assetId", assetId))
      .collect();

    const events = [
      ...inspections.map((i) => ({
        module: "safety" as const,
        kind: "inspection",
        at: i.completedAt ?? i.startedAt,
        ref: i._id as string,
        label: `Inspection (${i.score ?? "—"}%)`,
      })),
      ...workOrders.map((w) => ({
        module: "maintenance" as const,
        kind: "work_order",
        at: w.completedAt ?? w._creationTime,
        ref: w._id as string,
        label: `${w.kind} work order — ${w.status}`,
      })),
    ].sort((a, b) => b.at - a.at);

    return { asset, events };
  },
});

// MODULE: Maintenance — work orders.
//
// Demonstrates a NEW product module reusing the platform with almost no new machinery:
//   - it raises tasks into the SAME `actions` inbox (source: "work_order"),
//   - it references the SAME `assets` the safety module inspects (asset-360),
//   - a failed safety inspection can spawn a work order here (cross-module link),
//   - completing a work order writes the SAME `auditLog`.
// No new form engine, no new task system, no new asset table — that's the point.
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/** Raise a work order, optionally from a failed inspection item, with a linked task. */
export const create = mutation({
  args: {
    orgId: v.id("organizations"),
    title: v.string(),
    kind: v.union(
      v.literal("preventive"),
      v.literal("corrective"),
      v.literal("breakdown"),
      v.literal("inspection_followup"),
    ),
    assetId: v.optional(v.id("assets")),
    siteId: v.optional(v.id("sites")),
    assignedToId: v.optional(v.id("users")),
    inspectionId: v.optional(v.id("inspections")),
    priority: v.optional(
      v.union(v.literal("low"), v.literal("medium"), v.literal("high"), v.literal("critical")),
    ),
    scheduledFor: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const workOrderId = await ctx.db.insert("workOrders", {
      orgId: args.orgId,
      siteId: args.siteId,
      assetId: args.assetId,
      title: args.title,
      kind: args.kind,
      priority: args.priority ?? "medium",
      status: args.scheduledFor ? "scheduled" : "open",
      assignedToId: args.assignedToId,
      inspectionId: args.inspectionId,
      scheduledFor: args.scheduledFor,
    });

    // Same shared task inbox every module uses — just a different source/module.
    await ctx.db.insert("actions", {
      orgId: args.orgId,
      module: "maintenance",
      siteId: args.siteId,
      title: `Work order: ${args.title}`,
      assigneeId: args.assignedToId,
      priority: args.priority === "critical" ? "high" : args.priority ?? "medium",
      status: "todo",
      source: "work_order",
      workOrderId,
      dueDate: args.scheduledFor,
    });

    await ctx.db.insert("auditLog", {
      orgId: args.orgId,
      action: "workOrder.created",
      entityTable: "workOrders",
      entityId: workOrderId,
      at: Date.now(),
      meta: { kind: args.kind, fromInspection: args.inspectionId ?? null },
    });
    return workOrderId;
  },
});

/** All work orders for an asset — feeds the shared "asset 360" view alongside inspections. */
export const listForAsset = query({
  args: { assetId: v.id("assets") },
  handler: async (ctx, { assetId }) =>
    ctx.db
      .query("workOrders")
      .withIndex("by_asset", (q) => q.eq("assetId", assetId))
      .order("desc")
      .collect(),
});

export const setStatus = mutation({
  args: {
    workOrderId: v.id("workOrders"),
    status: v.union(
      v.literal("open"),
      v.literal("scheduled"),
      v.literal("in_progress"),
      v.literal("on_hold"),
      v.literal("completed"),
      v.literal("cancelled"),
    ),
  },
  handler: async (ctx, { workOrderId, status }) => {
    await ctx.db.patch(workOrderId, {
      status,
      ...(status === "completed" ? { completedAt: Date.now() } : {}),
    });
  },
});

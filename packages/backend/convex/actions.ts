// Corrective actions / tasks — the "close the loop" surface.
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const priority = v.union(v.literal("low"), v.literal("medium"), v.literal("high"));

export const create = mutation({
  args: {
    orgId: v.id("organizations"),
    title: v.string(),
    priority,
    siteId: v.optional(v.id("sites")),
    description: v.optional(v.string()),
    assigneeId: v.optional(v.id("users")),
    dueDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("actions", {
      orgId: args.orgId,
      siteId: args.siteId,
      title: args.title,
      description: args.description,
      assigneeId: args.assigneeId,
      priority: args.priority,
      status: "todo",
      dueDate: args.dueDate,
      source: "manual",
    });
  },
});

export const setStatus = mutation({
  args: {
    actionId: v.id("actions"),
    status: v.union(v.literal("todo"), v.literal("in_progress"), v.literal("done")),
  },
  handler: async (ctx, { actionId, status }) => {
    await ctx.db.patch(actionId, {
      status,
      completedAt: status === "done" ? Date.now() : undefined,
    });
  },
});

/** Open actions across the org (todo + in_progress). */
export const listOpen = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    const todo = await ctx.db
      .query("actions")
      .withIndex("by_org_status", (q) => q.eq("orgId", orgId).eq("status", "todo"))
      .collect();
    const inProgress = await ctx.db
      .query("actions")
      .withIndex("by_org_status", (q) => q.eq("orgId", orgId).eq("status", "in_progress"))
      .collect();
    return [...todo, ...inProgress];
  },
});

/** A user's assigned actions. */
export const listForAssignee = query({
  args: { assigneeId: v.id("users") },
  handler: async (ctx, { assigneeId }) => {
    return await ctx.db
      .query("actions")
      .withIndex("by_assignee", (q) => q.eq("assigneeId", assigneeId))
      .collect();
  },
});

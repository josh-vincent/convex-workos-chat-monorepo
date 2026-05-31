// Corrective actions / tasks — the "close the loop" surface.
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";

const priority = v.union(
  v.literal("low"),
  v.literal("medium"),
  v.literal("high"),
  v.literal("critical"),
);

const status = v.union(
  v.literal("todo"),
  v.literal("open"),
  v.literal("in_progress"),
  v.literal("done"),
  v.literal("verified"),
);

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

// ---------------------------------------------------------------------------
// Closed-loop (spec §5.4, DoD #11)
// ---------------------------------------------------------------------------

/** Patch any combination of status / assignedTo / dueAt / priority. */
export const update = mutation({
  args: {
    actionId: v.id("actions"),
    status: v.optional(status),
    assignedTo: v.optional(v.id("users")),
    dueAt: v.optional(v.number()),
    priority: v.optional(priority),
  },
  handler: async (ctx, { actionId, status: s, assignedTo, dueAt, priority: p }) => {
    // Patch only the fields that were explicitly provided.
    await ctx.db.patch(actionId, {
      ...(s !== undefined && { status: s }),
      ...(assignedTo !== undefined && { assignedTo }),
      ...(dueAt !== undefined && { dueAt }),
      ...(p !== undefined && { priority: p }),
    });
  },
});

const evidenceItem = v.object({
  mediaId: v.optional(v.id("media")),
  note: v.optional(v.string()),
});

/** Close the loop: record verifiable evidence and mark the action verified. */
export const verify = mutation({
  args: {
    actionId: v.id("actions"),
    evidence: v.array(evidenceItem),
  },
  handler: async (ctx, { actionId, evidence }) => {
    if (evidence.length === 0) {
      throw new ConvexError("At least one evidence item is required to verify an action.");
    }
    await ctx.db.patch(actionId, {
      status: "verified",
      evidence,
      verifiedAt: Date.now(),
    });
  },
});

/** All actions for an org; optionally filtered to a single assignee. */
export const listForOwner = query({
  args: {
    orgId: v.id("organizations"),
    assignedTo: v.optional(v.id("users")),
  },
  handler: async (ctx, { orgId, assignedTo }) => {
    if (assignedTo !== undefined) {
      return await ctx.db
        .query("actions")
        .withIndex("by_org_assignee", (q) =>
          q.eq("orgId", orgId).eq("assignedTo", assignedTo),
        )
        .collect();
    }
    return await ctx.db
      .query("actions")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
  },
});

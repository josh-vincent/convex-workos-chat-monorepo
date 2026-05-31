// Issues — hazards/defects raised by the frontline, optionally promoted to an action.
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const severity = v.union(
  v.literal("low"),
  v.literal("medium"),
  v.literal("high"),
  v.literal("critical"),
);

export const create = mutation({
  args: {
    orgId: v.id("organizations"),
    raisedBy: v.id("users"),
    title: v.string(),
    severity,
    siteId: v.optional(v.id("sites")),
    description: v.optional(v.string()),
    category: v.optional(v.string()),
    assetId: v.optional(v.id("assets")),
    inspectionId: v.optional(v.id("inspections")),
    mediaIds: v.optional(v.array(v.id("media"))),
    createAction: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const issueId = await ctx.db.insert("issues", {
      orgId: args.orgId,
      siteId: args.siteId,
      raisedBy: args.raisedBy,
      title: args.title,
      description: args.description,
      category: args.category,
      severity: args.severity,
      status: "open",
      assetId: args.assetId,
      inspectionId: args.inspectionId,
      mediaIds: args.mediaIds,
    });

    if (args.createAction) {
      // High/critical issues default to high priority.
      const priority = args.severity === "high" || args.severity === "critical" ? "high" : "medium";
      await ctx.db.insert("actions", {
        orgId: args.orgId,
        siteId: args.siteId,
        title: `Resolve issue: ${args.title}`,
        priority,
        status: "todo",
        source: "issue",
        issueId,
      });
    }

    await ctx.db.insert("auditLog", {
      orgId: args.orgId,
      actorId: args.raisedBy,
      action: "issue.created",
      entityTable: "issues",
      entityId: issueId,
      at: Date.now(),
      meta: { severity: args.severity },
    });
    return issueId;
  },
});

export const setStatus = mutation({
  args: {
    issueId: v.id("issues"),
    status: v.union(
      v.literal("open"),
      v.literal("in_progress"),
      v.literal("resolved"),
      v.literal("closed"),
    ),
  },
  handler: async (ctx, { issueId, status }) => {
    await ctx.db.patch(issueId, { status });
  },
});

export const list = query({
  args: {
    orgId: v.id("organizations"),
    status: v.optional(
      v.union(
        v.literal("open"),
        v.literal("in_progress"),
        v.literal("resolved"),
        v.literal("closed"),
      ),
    ),
  },
  handler: async (ctx, { orgId, status }) => {
    if (status) {
      return await ctx.db
        .query("issues")
        .withIndex("by_org_status", (q) => q.eq("orgId", orgId).eq("status", status))
        .order("desc")
        .collect();
    }
    return await ctx.db
      .query("issues")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .collect();
  },
});

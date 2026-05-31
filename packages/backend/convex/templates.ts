// Template queries & mutations — including NON-DESTRUCTIVE versioning.
import { mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { section } from "./schema";

/**
 * List the templates available to an org: its own (private + public) plus any
 * template shared publicly by another org. Fine for small orgs; prefer listPaginated
 * at scale.
 */
export const list = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    const own = await ctx.db
      .query("templates")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const shared = await ctx.db
      .query("templates")
      .withIndex("by_visibility", (q) => q.eq("visibility", "public"))
      .collect();
    const byId = new Map(own.map((t) => [t._id, t]));
    for (const t of shared) byId.set(t._id, t); // dedupe org's own public ones
    return [...byId.values()];
  },
});

/**
 * Paginated template library — the scalable path for an org with an unbounded number of
 * templates. The client drives this with `usePaginatedQuery`, loading a page at a time.
 * Optionally filtered by industry (vertical) for the pack browser.
 */
export const listPaginated = query({
  args: {
    orgId: v.id("organizations"),
    industry: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { orgId, industry, paginationOpts }) => {
    const base = ctx.db
      .query("templates")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc");
    const filtered = industry ? base.filter((q) => q.eq(q.field("industry"), industry)) : base;
    return await filtered.paginate(paginationOpts);
  },
});

/**
 * Full-text search across template names, org-scoped, optionally filtered by industry.
 * Paginated so even a huge template catalogue stays responsive.
 */
export const search = query({
  args: {
    orgId: v.id("organizations"),
    query: v.string(),
    industry: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { orgId, query: text, industry, paginationOpts }) => {
    return await ctx.db
      .query("templates")
      .withSearchIndex("search_name", (q) => {
        const s = q.search("name", text).eq("orgId", orgId);
        return industry ? s.eq("industry", industry) : s;
      })
      .paginate(paginationOpts);
  },
});

/** Get a template plus the content of a specific (default: current) version. */
export const getWithVersion = query({
  args: { templateId: v.id("templates"), version: v.optional(v.number()) },
  handler: async (ctx, { templateId, version }) => {
    const template = await ctx.db.get(templateId);
    if (!template) return null;
    const target = version ?? template.currentVersion;
    const tv = await ctx.db
      .query("templateVersions")
      .withIndex("by_template_version", (q) =>
        q.eq("templateId", templateId).eq("version", target),
      )
      .unique();
    return { template, version: tv };
  },
});

/** Full version history for a template (proves non-destructive editing). */
export const versionHistory = query({
  args: { templateId: v.id("templates") },
  handler: async (ctx, { templateId }) => {
    return await ctx.db
      .query("templateVersions")
      .withIndex("by_template", (q) => q.eq("templateId", templateId))
      .collect();
  },
});

/** Create a new template with its first (v1) version. */
export const create = mutation({
  args: {
    orgId: v.id("organizations"),
    key: v.string(),
    name: v.string(),
    category: v.string(),
    industry: v.string(),
    description: v.optional(v.string()),
    packKey: v.optional(v.string()),
    sections: v.array(section),
    scoringEnabled: v.boolean(),
    createdBy: v.optional(v.id("users")),
    visibility: v.optional(v.union(v.literal("private"), v.literal("public"))),
  },
  handler: async (ctx, args) => {
    const fieldCount = args.sections.reduce(
      (n, s) => n + s.questions.filter((q) => q.type !== "instruction").length,
      0,
    );
    const templateId = await ctx.db.insert("templates", {
      orgId: args.orgId,
      key: args.key,
      name: args.name,
      category: args.category,
      industry: args.industry,
      description: args.description,
      packKey: args.packKey,
      currentVersion: 1,
      status: "published",
      source: "custom", // built in-app via the form builder
      visibility: args.visibility ?? "private",
      fieldCount,
    });
    await ctx.db.insert("templateVersions", {
      templateId,
      version: 1,
      sections: args.sections,
      scoringEnabled: args.scoringEnabled,
      changeNote: "Initial version",
      createdBy: args.createdBy,
    });
    return templateId;
  },
});

/**
 * Publish a NEW version of an existing template. Crucially this never mutates or
 * deletes prior versions — historical inspections stay pinned to the version they ran
 * on. This is the fix for SafetyCulture's "editing a published template forces a rebuild".
 */
export const publishNewVersion = mutation({
  args: {
    templateId: v.id("templates"),
    sections: v.array(section),
    scoringEnabled: v.optional(v.boolean()),
    changeNote: v.optional(v.string()),
    createdBy: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const template = await ctx.db.get(args.templateId);
    if (!template) throw new Error("Template not found");
    const nextVersion = template.currentVersion + 1;

    await ctx.db.insert("templateVersions", {
      templateId: args.templateId,
      version: nextVersion,
      sections: args.sections,
      scoringEnabled: args.scoringEnabled ?? true,
      changeNote: args.changeNote,
      createdBy: args.createdBy,
    });
    await ctx.db.patch(args.templateId, {
      currentVersion: nextVersion,
      status: "published",
    });
    await ctx.db.insert("auditLog", {
      orgId: template.orgId,
      actorId: args.createdBy,
      action: "template.versioned",
      entityTable: "templates",
      entityId: args.templateId,
      at: Date.now(),
      meta: { version: nextVersion, changeNote: args.changeNote },
    });
    return nextVersion;
  },
});

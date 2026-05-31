// Inspection lifecycle: start (pins a template version) -> save responses -> complete
// (auto-scores, auto-creates corrective actions, and schedules a PDF report).
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { computeScore } from "./lib/scoring";
import { internal } from "./_generated/api";
import { workflow, retrier, scoreByOrg, scoreBySite } from "./components";
import type { Section } from "./templatePacks/types";

const responseValidator = v.object({
  questionId: v.string(),
  value: v.optional(v.any()),
  note: v.optional(v.string()),
  mediaIds: v.optional(v.array(v.id("media"))),
  flagged: v.optional(v.boolean()),
});

/** Start an inspection — snapshots the template's CURRENT version id so the run is reproducible. */
export const start = mutation({
  args: {
    orgId: v.id("organizations"),
    templateId: v.id("templates"),
    inspectorId: v.id("users"),
    siteId: v.optional(v.id("sites")),
    assetId: v.optional(v.id("assets")),
    // Anchor graph fields (spec §2, §5.2, §8) — optional, backward-compatible.
    anchorType: v.optional(
      v.union(
        v.literal("job"),
        v.literal("site"),
        v.literal("contract"),
        v.literal("person"),
        v.literal("asset"),
      ),
    ),
    anchorId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const template = await ctx.db.get(args.templateId);
    if (!template) throw new Error("Template not found");
    const tv = await ctx.db
      .query("templateVersions")
      .withIndex("by_template_version", (q) =>
        q.eq("templateId", args.templateId).eq("version", template.currentVersion),
      )
      .unique();
    if (!tv) throw new Error("Template version not found");

    return await ctx.db.insert("inspections", {
      orgId: args.orgId,
      siteId: args.siteId,
      templateId: args.templateId,
      templateVersionId: tv._id,
      version: template.currentVersion,
      inspectorId: args.inspectorId,
      status: "in_progress",
      startedAt: Date.now(),
      responses: [],
      assetId: args.assetId,
      anchorType: args.anchorType,
      anchorId: args.anchorId,
    });
  },
});

/** Save/replace the answer set (offline clients sync the full set). */
export const saveResponses = mutation({
  args: { inspectionId: v.id("inspections"), responses: v.array(responseValidator) },
  handler: async (ctx, { inspectionId, responses }) => {
    const insp = await ctx.db.get(inspectionId);
    if (!insp) throw new Error("Inspection not found");
    if (insp.status === "completed" || insp.status === "submitted") {
      throw new Error("Inspection is locked; create a revision instead.");
    }
    await ctx.db.patch(inspectionId, { responses });
  },
});

/** Complete: compute score, flag failures, auto-create corrective actions, audit-log it. */
export const complete = mutation({
  args: { inspectionId: v.id("inspections") },
  handler: async (ctx, { inspectionId }): Promise<{
    score?: number;
    flaggedQuestionIds: string[];
    actionsCreated: number;
    workflowId: string;
  }> => {
    const insp = await ctx.db.get(inspectionId);
    if (!insp) throw new Error("Inspection not found");
    const tv = await ctx.db.get(insp.templateVersionId);
    if (!tv) throw new Error("Template version missing");

    const result = computeScore(tv.sections as unknown as Section[], insp.responses);

    await ctx.db.patch(inspectionId, {
      status: "completed",
      score: result.score,
      completedAt: Date.now(),
    });

    // Update the analytics aggregates with the now-scored inspection so dashboard
    // averages / counts / leaderboards stay O(log n) (no collect()+reduce at read time).
    const scored = await ctx.db.get(inspectionId);
    if (scored && scored.score !== undefined) {
      await scoreByOrg.insertIfDoesNotExist(ctx, scored);
      await scoreBySite.insertIfDoesNotExist(ctx, scored);
    }

    let actionsCreated = 0;
    for (const f of result.failedTriggers) {
      await ctx.db.insert("actions", {
        orgId: insp.orgId,
        siteId: insp.siteId,
        title: `Corrective action: ${f.label}`,
        description: `Auto-created from a failed inspection item ("${f.label}").`,
        priority: "medium",
        status: "todo",
        source: "inspection",
        inspectionId,
      });
      actionsCreated++;
    }

    await ctx.db.insert("auditLog", {
      orgId: insp.orgId,
      actorId: insp.inspectorId,
      action: "inspection.completed",
      entityTable: "inspections",
      entityId: inspectionId,
      at: Date.now(),
      meta: {
        score: result.score,
        flagged: result.flaggedQuestionIds.length,
        actionsCreated,
      },
    });

    // Kick off the durable post-complete pipeline (PDF report → finalize → future
    // notifications). The Workflow component makes it resumable + exactly-once, and the
    // report step retries with backoff — replacing the old fire-and-forget scheduler call.
    const workflowId = await workflow.start(
      ctx,
      internal.workflows.inspectionCompleted,
      { inspectionId },
    );

    return {
      score: result.score,
      flaggedQuestionIds: result.flaggedQuestionIds,
      actionsCreated,
      workflowId,
    };
  },
});

/**
 * On-demand: (re)generate the PDF report for an inspection via the Action Retrier.
 * Unlike the workflow path, this is a one-shot retried run — handy for a "Regenerate report"
 * button. The retrier handles exponential backoff if the Node render action transiently fails.
 */
export const regenerateReport = mutation({
  args: { inspectionId: v.id("inspections") },
  handler: async (ctx, { inspectionId }): Promise<{ runId: string }> => {
    const runId = await retrier.run(ctx, internal.reports.generateInternal, { inspectionId });
    return { runId };
  },
});

/**
 * List inspections for an org (optionally by status), enriched with the template
 * and inspector names the office table needs — saves N follow-up reads per row.
 */
export const list = query({
  args: {
    orgId: v.id("organizations"),
    status: v.optional(
      v.union(
        v.literal("in_progress"),
        v.literal("completed"),
        v.literal("submitted"),
        v.literal("scheduled"),
        v.literal("actions_open"),
        v.literal("closed"),
        v.literal("overdue"),
      ),
    ),
  },
  handler: async (ctx, { orgId, status }) => {
    const rows = status
      ? await ctx.db
          .query("inspections")
          .withIndex("by_org_status", (q) => q.eq("orgId", orgId).eq("status", status))
          .order("desc")
          .collect()
      : await ctx.db
          .query("inspections")
          .withIndex("by_org", (q) => q.eq("orgId", orgId))
          .order("desc")
          .collect();

    return await Promise.all(
      rows.map(async (insp) => {
        const [template, inspector] = await Promise.all([
          ctx.db.get(insp.templateId),
          ctx.db.get(insp.inspectorId),
        ]);
        return {
          ...insp,
          templateName: template?.name ?? "Inspection",
          inspectorName: inspector?.name ?? "Unknown",
        };
      }),
    );
  },
});

/** Set/replace a single answer (used by the AI assistant tools and quick edits). */
export const setAnswer = mutation({
  args: {
    inspectionId: v.id("inspections"),
    questionId: v.string(),
    value: v.optional(v.any()),
    note: v.optional(v.string()),
    flagged: v.optional(v.boolean()),
  },
  handler: async (ctx, { inspectionId, questionId, value, note, flagged }) => {
    const insp = await ctx.db.get(inspectionId);
    if (!insp) throw new Error("Inspection not found");
    if (insp.status === "completed" || insp.status === "submitted") {
      throw new Error("Inspection is locked; create a revision instead.");
    }
    const responses = insp.responses.filter((r) => r.questionId !== questionId);
    responses.push({ questionId, value, note, flagged });
    await ctx.db.patch(inspectionId, { responses });
    return { ok: true };
  },
});

/**
 * Revise a completed or submitted inspection — creates a new in_progress copy and
 * marks the old row with supersededById (append-only, spec §5.2, §10, DoD #2).
 * Does NOT call complete()/workflow.start/scoreByOrg/scoreBySite.
 */
export const revise = mutation({
  args: { inspectionId: v.id("inspections") },
  handler: async (ctx, { inspectionId }) => {
    const insp = await ctx.db.get(inspectionId);
    if (!insp) throw new Error("Inspection not found");
    if (insp.status !== "completed" && insp.status !== "submitted") {
      throw new Error(
        "Only completed or submitted inspections can be revised; this inspection is still in_progress.",
      );
    }

    const newId = await ctx.db.insert("inspections", {
      orgId: insp.orgId,
      templateId: insp.templateId,
      templateVersionId: insp.templateVersionId,
      version: insp.version,
      inspectorId: insp.inspectorId,
      status: "in_progress",
      startedAt: Date.now(),
      responses: insp.responses,
      anchorType: insp.anchorType,
      anchorId: insp.anchorId,
    });

    await ctx.db.patch(inspectionId, { supersededById: newId });

    return newId;
  },
});

/**
 * Append a sign-off entry to an inspection's signOffs array.
 * Pure db reads/writes — no component calls (workflow/scoreByOrg/scoreBySite).
 */
export const signOn = mutation({
  args: {
    inspectionId: v.id("inspections"),
    userId: v.id("users"),
    role: v.optional(v.string()),
    signatureMediaId: v.optional(v.id("media")),
  },
  handler: async (ctx, { inspectionId, userId, role, signatureMediaId }) => {
    const insp = await ctx.db.get(inspectionId);
    if (!insp) throw new Error("Inspection not found");

    const existing = insp.signOffs ?? [];
    const entry: {
      userId: typeof userId;
      at: number;
      role?: string;
      signatureMediaId?: typeof signatureMediaId;
    } = { userId, at: Date.now() };
    if (role !== undefined) entry.role = role;
    if (signatureMediaId !== undefined) entry.signatureMediaId = signatureMediaId;

    await ctx.db.patch(inspectionId, { signOffs: [...existing, entry] });
    return { ok: true };
  },
});

/**
 * Check whether all corrective actions linked to this inspection are verified,
 * then transition the inspection to "closed" or "actions_open" accordingly.
 * Pure db reads/writes — no component calls.
 */
export const closeIfResolved = mutation({
  args: { inspectionId: v.id("inspections") },
  handler: async (ctx, { inspectionId }): Promise<{ status: "closed" | "actions_open" }> => {
    const insp = await ctx.db.get(inspectionId);
    if (!insp) throw new Error("Inspection not found");

    const linkedActions = await ctx.db
      .query("actions")
      .withIndex("by_org", (q) => q.eq("orgId", insp.orgId))
      .filter((q) => q.eq(q.field("inspectionId"), inspectionId))
      .collect();

    const allVerified =
      linkedActions.length === 0 ||
      linkedActions.every((a) => a.status === "verified");

    const newStatus: "closed" | "actions_open" = allVerified ? "closed" : "actions_open";
    await ctx.db.patch(inspectionId, { status: newStatus });
    return { status: newStatus };
  },
});

/** An inspection plus the frozen template version it runs on (the questions to render). */
export const get = query({
  args: { inspectionId: v.id("inspections") },
  handler: async (ctx, { inspectionId }) => {
    const inspection = await ctx.db.get(inspectionId);
    if (!inspection) return null;
    const tv = await ctx.db.get(inspection.templateVersionId);
    const template = await ctx.db.get(inspection.templateId);
    return {
      inspection,
      templateName: template?.name ?? "Inspection",
      sections: tv?.sections ?? [],
      scoringEnabled: tv?.scoringEnabled ?? true,
    };
  },
});

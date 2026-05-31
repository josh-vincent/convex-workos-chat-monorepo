// convex/reportData.ts — V8 (non-node) query + mutation used by the PDF report action.
// Kept separate from convex/reports.ts because that module is `"use node"`; queries and
// mutations must run in the default Convex runtime.
import { internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { question as questionValidator } from "./schema";

/** Assemble everything reports/inspectionReport.tsx needs for one inspection. */
export const forInspection = internalQuery({
  args: { inspectionId: v.id("inspections") },
  handler: async (ctx, { inspectionId }) => {
    const insp = await ctx.db.get(inspectionId);
    if (!insp) return null;
    const tv = await ctx.db.get(insp.templateVersionId);
    if (!tv) return null;
    const template = await ctx.db.get(insp.templateId);
    const org = await ctx.db.get(insp.orgId);
    const inspector = await ctx.db.get(insp.inspectorId);
    const site = insp.siteId ? await ctx.db.get(insp.siteId) : null;

    return {
      orgId: insp.orgId,
      orgName: org?.name ?? "Organization",
      templateName: template?.name ?? "Inspection",
      templateCategory: template?.category,
      version: insp.version,
      sections: tv.sections,
      scoringEnabled: tv.scoringEnabled,
      responses: insp.responses.map((r) => ({
        questionId: r.questionId,
        value: r.value,
        note: r.note,
        flagged: r.flagged,
      })),
      score: insp.score,
      inspectorName: inspector?.name,
      siteName: site?.name ?? undefined,
      startedAt: insp.startedAt,
      completedAt: insp.completedAt,
    };
  },
});

/** Record the stored PDF: add a media row and pin its storage id on the inspection. */
export const attachReport = internalMutation({
  args: {
    inspectionId: v.id("inspections"),
    storageId: v.id("_storage"),
    orgId: v.id("organizations"),
  },
  handler: async (ctx, { inspectionId, storageId, orgId }) => {
    const mediaId = await ctx.db.insert("media", {
      orgId,
      storageId,
      kind: "doc",
    });
    await ctx.db.patch(inspectionId, { reportStorageId: storageId, reportMediaId: mediaId });
    await ctx.db.insert("auditLog", {
      orgId,
      action: "inspection.report_generated",
      entityTable: "inspections",
      entityId: inspectionId,
      at: Date.now(),
      meta: { storageId },
    });
    return mediaId;
  },
});

/** Final step of the inspectionCompleted workflow — records that the pipeline finished. */
export const markPipelineDone = internalMutation({
  args: { inspectionId: v.id("inspections") },
  handler: async (ctx, { inspectionId }) => {
    const insp = await ctx.db.get(inspectionId);
    if (!insp) return;
    await ctx.db.insert("auditLog", {
      orgId: insp.orgId,
      action: "inspection.pipeline_completed",
      entityTable: "inspections",
      entityId: inspectionId,
      at: Date.now(),
      meta: { reportStorageId: insp.reportStorageId ?? null },
    });
  },
});

// Referenced to keep validator import meaningful for future report-field tooling.
export const _questionValidator = questionValidator;

"use node";
// Renders a completed inspection to a PDF (pdf-lib -- pure JS, bundles cleanly in the
// Convex Node runtime), stores it in file storage, and pins it to the inspection via
// reportData.attachReport. Called by the inspectionCompleted workflow (generateInternal,
// retried) and on demand (generate -> returns a URL the apps can open).
import { v } from "convex/values";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { buildInspectionPdf, type ReportData } from "./lib/buildInspectionPdf";

async function render(ctx: ActionCtx, inspectionId: string) {
  const data = (await ctx.runQuery(internal.reportData.forInspection, {
    inspectionId: inspectionId as never,
  })) as ReportData | null;
  if (!data) throw new Error("Inspection not found");

  // Pull the bytes for each attached photo so they can be embedded in the PDF.
  const photoBytes = new Map<string, Uint8Array>();
  for (const r of data.responses) {
    for (const m of r.media ?? []) {
      if (m.kind === "doc" || photoBytes.has(m.storageId)) continue;
      try {
        const blob = await ctx.storage.get(m.storageId as Id<"_storage">);
        if (blob) photoBytes.set(m.storageId, new Uint8Array(await blob.arrayBuffer()));
      } catch {
        /* missing blob -- skip */
      }
    }
  }

  const bytes = await buildInspectionPdf(data, photoBytes);
  const storageId = await ctx.storage.store(
    new Blob([bytes as unknown as BlobPart], { type: "application/pdf" }),
  );
  await ctx.runMutation(internal.reportData.attachReport, {
    inspectionId: inspectionId as never,
    storageId,
    orgId: data.orgId as never,
  });
  return { storageId, url: await ctx.storage.getUrl(storageId) };
}

export const generateInternal = internalAction({
  args: { inspectionId: v.id("inspections") },
  handler: (ctx, { inspectionId }) => render(ctx, inspectionId),
});

export const generate = action({
  args: { inspectionId: v.id("inspections") },
  handler: (ctx, { inspectionId }) => render(ctx, inspectionId),
});

// PDF report generation is STUBBED in this template.
//
// In the source project this rendered `reports/inspectionReport.tsx` with
// @react-pdf/renderer (a Node action) and stored the PDF in Convex file storage.
// That document component lived outside `convex/`, so it isn't bundled here.
//
// To restore real reports: add a react-pdf document back under `convex/` and render
// it in `generateInternal` (keep the "use node" directive + renderToBuffer), then call
// internal.reportData.attachReport with the stored file. The workflow + the
// "Regenerate report" mutation already call generateInternal.
import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";

export const generateInternal = internalAction({
  args: { inspectionId: v.id("inspections") },
  handler: async () => {
    return { stubbed: true } as const;
  },
});

export const generate = action({
  args: { inspectionId: v.id("inspections") },
  handler: async () => {
    return { stubbed: true } as const;
  },
});

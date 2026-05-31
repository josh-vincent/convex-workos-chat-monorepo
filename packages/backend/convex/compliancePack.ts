"use node";
// convex/compliancePack.ts — "use node" action for compliance-pack delivery (spec §10).
//
// Calls the packData query (convex/compliance.ts) and returns a JSON manifest
// string.  In production this would be uploaded to Convex file storage and the
// signed URL returned; here we keep it minimal so the file type-checks cleanly.

import { action } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";

export const pack = action({
  args: {
    anchorType: v.union(
      v.literal("job"),
      v.literal("site"),
      v.literal("contract"),
      v.literal("person"),
      v.literal("asset"),
    ),
    anchorId: v.string(),
  },
  handler: async (ctx, { anchorType, anchorId }): Promise<string> => {
    const manifest = await ctx.runQuery(api.compliance.packData, {
      anchorType,
      anchorId,
    });

    // In a full implementation this would:
    //   1. Render the manifest to PDF / ZIP bundle.
    //   2. Upload to ctx.storage (Convex file storage).
    //   3. Return await ctx.storage.getUrl(storageId).
    // For now, return the JSON-serialised manifest as a data-URL so callers
    // can always get a usable string back (keeps this action type-check-clean
    // without introducing a test dependency on file storage).
    const json = JSON.stringify(manifest);
    const dataUrl = `data:application/json;base64,${Buffer.from(json).toString("base64")}`;
    return dataUrl;
  },
});

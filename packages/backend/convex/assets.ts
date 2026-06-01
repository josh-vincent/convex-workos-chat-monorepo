import { v } from "convex/values";
import { query } from "./_generated/server";

/**
 * Resolve an asset/plant item by its QR-code string, scoped to the org.
 * Used by the assistant's `lookupAsset` tool (and assetScan questions) to bind
 * plant to an inspection. Returns null when nothing matches.
 */
export const getByQr = query({
  args: { orgId: v.id("organizations"), qrCode: v.string() },
  handler: async (ctx, { orgId, qrCode }) => {
    const asset = await ctx.db
      .query("assets")
      .withIndex("by_qr", (q) => q.eq("qrCode", qrCode))
      .filter((q) => q.eq(q.field("orgId"), orgId))
      .first();
    return asset ?? null;
  },
});

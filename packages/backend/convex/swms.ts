// SWMS (Safe Work Method Statements) — first-class record functions.
// spec §9, DoD #7.
import { mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Share a SWMS inspection with a principal contractor.
 *
 * Sets `principalContractorId` and `swmsSharedAt` on the inspection row,
 * and appends an auditLog entry with action "swms.shared_with_principal".
 * Re-sharing is allowed: updates `swmsSharedAt` and inserts a new log each time.
 *
 * Returns `{ sharedAt }` — the epoch-ms timestamp written to the row.
 */
export const shareToPrincipal = mutation({
  args: {
    inspectionId: v.id("inspections"),
    principalContractorId: v.id("contracts"),
  },
  handler: async (ctx, { inspectionId, principalContractorId }) => {
    const inspection = await ctx.db.get(inspectionId);
    if (!inspection) {
      throw new Error(`Inspection ${inspectionId} not found`);
    }

    const sharedAt = Date.now();

    await ctx.db.patch(inspectionId, {
      principalContractorId,
      swmsSharedAt: sharedAt,
    });

    await ctx.db.insert("auditLog", {
      orgId: inspection.orgId,
      action: "swms.shared_with_principal",
      entityTable: "inspections",
      entityId: inspectionId,
      at: sharedAt,
    });

    return { sharedAt };
  },
});

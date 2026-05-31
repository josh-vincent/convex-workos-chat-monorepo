// convex/compliance.ts — Compliance-pack assembly (spec §10, DoD #10).
//
// Exports:
//   packData (query)  — assembles a manifest for a given anchor (job/site/contract/person/asset):
//     { anchor, inspections, actions, registers (with derived status), mediaIds, counts }
//
// The companion "use node" action `compliance.pack` lives in convex/compliancePack.ts
// (separate file required because "use node" and non-node exports cannot share a module).

import { query } from "./_generated/server";
import { v } from "convex/values";
import { currencyStatus } from "./lib/currency";
import type { Doc } from "./_generated/dataModel";

// ---------------------------------------------------------------------------
// Shared validators
// ---------------------------------------------------------------------------

const inspectionAnchorTypeValidator = v.union(
  v.literal("job"),
  v.literal("site"),
  v.literal("contract"),
  v.literal("person"),
  v.literal("asset"),
);

// Default lead-time window for currency status derivation (matches registers.ts).
const DEFAULT_LEAD_DAYS = 30;

// ---------------------------------------------------------------------------
// packData (public query)
// ---------------------------------------------------------------------------

/**
 * Assemble a compliance-pack manifest for the given anchor.
 *
 * Returns:
 *   anchor      — echoes the input { anchorType, anchorId }
 *   inspections — all inspection rows anchored to (anchorType, anchorId)
 *   actions     — all action rows whose inspectionId is in those inspections
 *   registers   — register entries for the anchor (only site/person/asset are
 *                 supported by the registerEntries table; job/contract → [])
 *                 Each entry is augmented with a derived `status` field.
 *   mediaIds    — de-duplicated media ids from inspection responses + register documentRefs
 *   counts      — { inspections, actions, registers, mediaIds } matching the array lengths
 */
export const packData = query({
  args: {
    anchorType: inspectionAnchorTypeValidator,
    anchorId: v.string(),
  },
  handler: async (ctx, { anchorType, anchorId }) => {
    // ── 1. Inspections ───────────────────────────────────────────────────────
    const inspections = await ctx.db
      .query("inspections")
      .withIndex("by_anchor", (q) =>
        q.eq("anchorType", anchorType).eq("anchorId", anchorId),
      )
      .collect();

    // ── 2. Actions — linked to any of those inspections ─────────────────────
    const inspectionIdSet = new Set(inspections.map((i) => i._id));

    // Collect all actions in parallel for each inspection id.
    const actionArrays = await Promise.all(
      Array.from(inspectionIdSet).map((inspId) =>
        ctx.db
          .query("actions")
          .filter((q) => q.eq(q.field("inspectionId"), inspId))
          .collect(),
      ),
    );
    const actions = actionArrays.flat();

    // ── 3. Register entries — only for anchor types the table supports ───────
    // registerEntries.anchorType union: person | site | asset | subcontractor
    // inspections.anchorType union:     job   | site | contract | person | asset
    // Mapping:
    //   "job"      → no match → []
    //   "contract" → no match → []
    //   "site"     → "site"
    //   "person"   → "person"
    //   "asset"    → "asset"
    type RegisterAnchorType = "person" | "site" | "asset" | "subcontractor";

    let rawRegisterEntries: Doc<"registerEntries">[] = [];

    const registerAnchorTypeMap: Partial<
      Record<typeof anchorType, RegisterAnchorType>
    > = {
      site: "site",
      person: "person",
      asset: "asset",
    };
    const registerAnchorType = registerAnchorTypeMap[anchorType];

    if (registerAnchorType !== undefined) {
      rawRegisterEntries = await ctx.db
        .query("registerEntries")
        .withIndex("by_anchor", (q) =>
          q.eq("anchorType", registerAnchorType).eq("anchorId", anchorId),
        )
        .collect();
    }

    // ── 4. Derive currency status on each register entry ─────────────────────
    const nowMs = Date.now();
    const registers = rawRegisterEntries.map((entry) => ({
      ...entry,
      status: currencyStatus(entry, nowMs, DEFAULT_LEAD_DAYS),
    }));

    // ── 5. Media ids — de-duplicated ─────────────────────────────────────────
    const mediaIdSet = new Set<string>();

    for (const insp of inspections) {
      for (const response of insp.responses) {
        for (const mediaId of response.mediaIds ?? []) {
          mediaIdSet.add(mediaId);
        }
      }
    }

    for (const entry of rawRegisterEntries) {
      if (entry.documentRef !== undefined) {
        mediaIdSet.add(entry.documentRef);
      }
    }

    const mediaIds = Array.from(mediaIdSet);

    // ── 6. Counts ─────────────────────────────────────────────────────────────
    const counts = {
      inspections: inspections.length,
      actions: actions.length,
      registers: registers.length,
      mediaIds: mediaIds.length,
    };

    return {
      anchor: { anchorType, anchorId },
      inspections,
      actions,
      registers,
      mediaIds,
      counts,
    };
  },
});

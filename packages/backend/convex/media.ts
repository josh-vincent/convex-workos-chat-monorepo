// File attachments for inspection items — Convex file storage + the `media` table.
// Flow: generateUploadUrl → client POSTs bytes → record(storageId) → mediaId on the
// inspection response. urls() resolves mediaIds to displayable URLs.
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const KIND = v.union(
  v.literal("photo"),
  v.literal("video"),
  v.literal("signature"),
  v.literal("doc"),
);

/** Short-lived URL the client POSTs the file bytes to. */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    return await ctx.storage.generateUploadUrl();
  },
});

/** Record an uploaded file in `media` and return its id + a displayable URL. */
export const record = mutation({
  args: {
    orgId: v.id("organizations"),
    storageId: v.id("_storage"),
    kind: v.optional(KIND),
    name: v.optional(v.string()),
    // Tamper-evident evidence metadata (spec §5.5, §10, DoD #3).
    capturedAt: v.optional(v.number()),
    capturedBy: v.optional(v.id("users")),
    geo: v.optional(v.object({
      lat: v.number(),
      lng: v.number(),
      accuracy: v.optional(v.number()),
    })),
    contentHash: v.optional(v.string()),
  },
  handler: async (ctx, { orgId, storageId, kind, name, capturedAt, capturedBy, geo, contentHash }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const resolvedKind = kind ?? "photo";
    const mediaId = await ctx.db.insert("media", {
      orgId,
      storageId,
      kind: resolvedKind,
      name,
      capturedAt,
      capturedBy,
      geo,
      contentHash,
    });
    return {
      mediaId,
      url: await ctx.storage.getUrl(storageId),
      kind: resolvedKind,
      name: name ?? null,
    };
  },
});

/** Resolve media ids to display URLs + kind/name (thumbnails for photos, chips for docs). */
export const urls = query({
  args: { ids: v.array(v.id("media")) },
  handler: async (ctx, { ids }) => {
    const out: {
      mediaId: (typeof ids)[number];
      url: string | null;
      kind: string;
      name: string | null;
      capturedAt?: number;
      geo?: { lat: number; lng: number; accuracy?: number };
      contentHash?: string;
    }[] = [];
    for (const id of ids) {
      const m = await ctx.db.get(id);
      if (m)
        out.push({
          mediaId: id,
          url: await ctx.storage.getUrl(m.storageId),
          kind: m.kind,
          name: m.name ?? null,
          capturedAt: m.capturedAt,
          geo: m.geo,
          contentHash: m.contentHash,
        });
    }
    return out;
  },
});

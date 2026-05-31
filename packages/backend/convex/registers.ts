// Register entries — spec §5.3, DoD #4.
// Tracks currency of licences, competencies, SDS, insurance, plant, and inductions.
// The `status` field on list results is NEVER stored; it is derived at query time.
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { currencyStatus } from "./lib/currency";

// ---------------------------------------------------------------------------
// Shared validators
// ---------------------------------------------------------------------------

const registerTypeValidator = v.union(
  v.literal("licence"),
  v.literal("competency"),
  v.literal("sds"),
  v.literal("insurance"),
  v.literal("plant"),
  v.literal("induction"),
);

const anchorTypeValidator = v.union(
  v.literal("person"),
  v.literal("site"),
  v.literal("asset"),
  v.literal("subcontractor"),
);

// Default lead-time window used by currencyStatus when an entry has no
// per-entry leadTimeDays set.  30 days is a reasonable safety default.
const DEFAULT_LEAD_DAYS = 30;

// ---------------------------------------------------------------------------
// upsert
// ---------------------------------------------------------------------------

/**
 * Insert or update a register entry.
 *
 * Natural key: (orgId, registerType, anchorType, anchorId).
 * A second call with the same key patches the existing row in place and
 * returns the same document id.
 */
export const upsert = mutation({
  args: {
    orgId: v.id("organizations"),
    registerType: registerTypeValidator,
    anchorType: anchorTypeValidator,
    anchorId: v.string(),
    label: v.string(),
    identifier: v.optional(v.string()),
    issuedAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    reviewEveryDays: v.optional(v.number()),
    leadTimeDays: v.optional(v.number()),
    documentRef: v.optional(v.id("media")),
    verifiedBy: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const { orgId, registerType, anchorType, anchorId, ...fields } = args;

    // Attempt to find an existing row by the natural key.
    // by_org index lets us narrow to the org cheaply, then filter in JS.
    const existing = await ctx.db
      .query("registerEntries")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .filter((q) =>
        q.and(
          q.eq(q.field("registerType"), registerType),
          q.eq(q.field("anchorType"), anchorType),
          q.eq(q.field("anchorId"), anchorId),
        ),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, fields);
      return existing._id;
    }

    return await ctx.db.insert("registerEntries", {
      orgId,
      registerType,
      anchorType,
      anchorId,
      ...fields,
    });
  },
});

// ---------------------------------------------------------------------------
// seedSampleRegisters — idempotent mutation for Tier-1 register coverage
// ---------------------------------------------------------------------------

/**
 * Inserts one SDS entry and one induction entry for the given anchor.
 *
 * Idempotent: a second call with the same (orgId, anchorId) returns the same
 * document ids without creating duplicate rows.
 *
 * Returns { sdsId, inductionId }.
 */
export const seedSampleRegisters = mutation({
  args: {
    orgId: v.id("organizations"),
    anchorId: v.string(),
  },
  handler: async (ctx, { orgId, anchorId }) => {
    // Check for existing SDS entry.
    const existingSds = await ctx.db
      .query("registerEntries")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .filter((q) =>
        q.and(
          q.eq(q.field("registerType"), "sds"),
          q.eq(q.field("anchorId"), anchorId),
        ),
      )
      .first();

    // Check for existing induction entry.
    const existingInduction = await ctx.db
      .query("registerEntries")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .filter((q) =>
        q.and(
          q.eq(q.field("registerType"), "induction"),
          q.eq(q.field("anchorId"), anchorId),
        ),
      )
      .first();

    const sdsId =
      existingSds?._id ??
      (await ctx.db.insert("registerEntries", {
        orgId,
        registerType: "sds",
        anchorType: "site",
        anchorId,
        label: "Sample SDS Entry",
      }));

    const inductionId =
      existingInduction?._id ??
      (await ctx.db.insert("registerEntries", {
        orgId,
        registerType: "induction",
        anchorType: "site",
        anchorId,
        label: "Sample Induction Entry",
      }));

    return { sdsId, inductionId };
  },
});

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

/**
 * Return all register entries for an org with a derived `status` field.
 *
 * `status` is computed via currencyStatus() at query time and is NEVER stored.
 */
export const list = query({
  args: {
    orgId: v.id("organizations"),
  },
  handler: async (ctx, { orgId }) => {
    const entries = await ctx.db
      .query("registerEntries")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();

    const nowMs = Date.now();

    return entries.map((entry) => ({
      ...entry,
      status: currencyStatus(entry, nowMs, DEFAULT_LEAD_DAYS),
    }));
  },
});

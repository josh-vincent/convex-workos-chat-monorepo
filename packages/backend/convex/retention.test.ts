/**
 * Tests for Statutory Retention — prevent deletion before retention period elapses
 * (spec §10, DoD #10-adjacent).
 *
 * Intended API (to be implemented):
 *
 *  convex/lib/retention.ts — pure module, no Convex imports:
 *
 *    `retentionYears(recordType: string, jurisdiction: string, configRows: Array<{ jurisdiction: string; key: string; value: unknown }>): number`
 *      Resolution order:
 *        1. Row matching jurisdiction and key "retention_years." + recordType → value as number
 *        2. Row matching "generic" and key "retention_years." + recordType → value as number
 *        3. Default: 5
 *
 *    `canDelete(record: { completedAt?: number; createdAt?: number }, nowMs: number, years: number): boolean`
 *      Returns true when now >= (completedAt ?? createdAt) + years * MS_PER_YEAR.
 *      If years is 0 (or null/undefined treated as 0 by the caller) → always true.
 *      If the anchor timestamp is undefined → falls back to the other timestamp;
 *      if both are undefined → returns true (no retention applies).
 *
 *  convex/records.ts — adds a new mutation (existing `byAnchor` query is untouched):
 *
 *    `records.tryDelete({ inspectionId })` (mutation) — no auth required for tests
 *      - Reads the inspection row; throws ConvexError (or Error) with a message
 *        containing "retention" if the retention period has not elapsed.
 *      - Uses `retentionYears("inspection", jurisdiction, configRows)` where
 *        jurisdiction is either the inspection org's jurisdiction or "generic",
 *        and configRows are fetched from the `jurisdictionConfigs` table.
 *      - If canDelete passes, deletes the inspection row and returns { deleted: true }.
 *      - If the inspection does not exist, throws an error (message contains "not found"
 *        or similar, OR any error — implementer's choice).
 *
 * convex-test safe:
 *  - retentionYears and canDelete are pure unit tests (no Convex harness).
 *  - Integration tests insert rows directly via ctx.db.insert (no inspections.complete).
 *  - records.tryDelete is a plain mutation — no component calls, no workflow.start.
 */

import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

// ---------------------------------------------------------------------------
// Module glob — same exclusions as all other test files in this repo.
// ---------------------------------------------------------------------------

const modules = import.meta.glob(
  [
    "./**/*.ts",
    "./**/*.tsx",
    "!./components.ts",
    "!./workflows.ts",
    "!./reports.tsx",
  ],
  { eager: false },
);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_YEAR = 365 * MS_PER_DAY;

// Fixed reference point for deterministic tests — 2030-06-01T00:00:00.000Z
const NOW = new Date("2030-06-01T00:00:00.000Z").getTime();

// ---------------------------------------------------------------------------
// Dynamic import helpers for pure lib modules
// ---------------------------------------------------------------------------

async function loadRetention() {
  const mod = await import("./lib/retention");
  return {
    retentionYears: mod.retentionYears as (
      recordType: string,
      jurisdiction: string,
      configRows: Array<{ jurisdiction: string; key: string; value: unknown }>,
    ) => number,
    canDelete: mod.canDelete as (
      record: { completedAt?: number; createdAt?: number },
      nowMs: number,
      years: number,
    ) => boolean,
  };
}

// ---------------------------------------------------------------------------
// canDelete — pure unit tests
// ---------------------------------------------------------------------------

describe("canDelete — basic retention logic", () => {
  test("returns false the day after completion with 5-year retention", async () => {
    const { canDelete } = await loadRetention();
    // Completed one day ago → well within the 5-year window
    const completedAt = NOW - 1 * MS_PER_DAY;
    expect(canDelete({ completedAt }, NOW, 5)).toBe(false);
  });

  test("returns false one year after completion with 5-year retention", async () => {
    const { canDelete } = await loadRetention();
    const completedAt = NOW - 365 * MS_PER_DAY;
    expect(canDelete({ completedAt }, NOW, 5)).toBe(false);
  });

  test("returns false one day before the retention period expires", async () => {
    const { canDelete } = await loadRetention();
    // 5 years minus 1 day → still within retention
    const completedAt = NOW - (5 * MS_PER_YEAR - MS_PER_DAY);
    expect(canDelete({ completedAt }, NOW, 5)).toBe(false);
  });

  test("returns true exactly at the retention boundary (completedAt + years = now)", async () => {
    const { canDelete } = await loadRetention();
    const completedAt = NOW - 5 * MS_PER_YEAR;
    // now === completedAt + 5y → boundary — should be deletable
    expect(canDelete({ completedAt }, NOW, 5)).toBe(true);
  });

  test("returns true 5 years + 1 day after completion with 5-year retention", async () => {
    const { canDelete } = await loadRetention();
    const completedAt = NOW - (5 * MS_PER_YEAR + MS_PER_DAY);
    expect(canDelete({ completedAt }, NOW, 5)).toBe(true);
  });

  test("returns true 10 years after completion with 5-year retention", async () => {
    const { canDelete } = await loadRetention();
    const completedAt = NOW - 10 * MS_PER_YEAR;
    expect(canDelete({ completedAt }, NOW, 5)).toBe(true);
  });
});

describe("canDelete — zero years (no retention)", () => {
  test("returns true immediately when years = 0", async () => {
    const { canDelete } = await loadRetention();
    // Completed just now — but no retention required
    const completedAt = NOW;
    expect(canDelete({ completedAt }, NOW, 0)).toBe(true);
  });

  test("returns true even for a very recent record when years = 0", async () => {
    const { canDelete } = await loadRetention();
    const completedAt = NOW - 1; // 1 ms ago
    expect(canDelete({ completedAt }, NOW, 0)).toBe(true);
  });
});

describe("canDelete — timestamp fallback rules", () => {
  test("falls back to createdAt when completedAt is undefined", async () => {
    const { canDelete } = await loadRetention();
    // createdAt is 6 years ago → beyond 5-year retention → deletable
    const createdAt = NOW - 6 * MS_PER_YEAR;
    expect(canDelete({ createdAt }, NOW, 5)).toBe(true);
  });

  test("createdAt within retention window → false", async () => {
    const { canDelete } = await loadRetention();
    const createdAt = NOW - 2 * MS_PER_YEAR;
    expect(canDelete({ createdAt }, NOW, 5)).toBe(false);
  });

  test("completedAt takes precedence over createdAt", async () => {
    const { canDelete } = await loadRetention();
    // createdAt is old enough (6y) but completedAt is recent (1d) → still within retention
    const createdAt = NOW - 6 * MS_PER_YEAR;
    const completedAt = NOW - 1 * MS_PER_DAY;
    expect(canDelete({ completedAt, createdAt }, NOW, 5)).toBe(false);
  });

  test("both timestamps undefined → returns true (no retention anchor)", async () => {
    const { canDelete } = await loadRetention();
    expect(canDelete({}, NOW, 5)).toBe(true);
  });
});

describe("canDelete — different retention periods", () => {
  test("1-year retention: record completed 400 days ago → true", async () => {
    const { canDelete } = await loadRetention();
    const completedAt = NOW - 400 * MS_PER_DAY;
    expect(canDelete({ completedAt }, NOW, 1)).toBe(true);
  });

  test("1-year retention: record completed 300 days ago → false", async () => {
    const { canDelete } = await loadRetention();
    const completedAt = NOW - 300 * MS_PER_DAY;
    expect(canDelete({ completedAt }, NOW, 1)).toBe(false);
  });

  test("7-year retention: record completed 6 years ago → false", async () => {
    const { canDelete } = await loadRetention();
    const completedAt = NOW - 6 * MS_PER_YEAR;
    expect(canDelete({ completedAt }, NOW, 7)).toBe(false);
  });

  test("7-year retention: record completed 8 years ago → true", async () => {
    const { canDelete } = await loadRetention();
    const completedAt = NOW - 8 * MS_PER_YEAR;
    expect(canDelete({ completedAt }, NOW, 7)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// retentionYears — pure unit tests
// ---------------------------------------------------------------------------

describe("retentionYears — jurisdiction-specific override wins", () => {
  test("uses jurisdiction-specific config row when present", async () => {
    const { retentionYears } = await loadRetention();

    const configRows = [
      { jurisdiction: "vic_ohs", key: "retention_years.inspection", value: 7 },
      { jurisdiction: "generic", key: "retention_years.inspection", value: 5 },
    ];

    expect(retentionYears("inspection", "vic_ohs", configRows)).toBe(7);
  });

  test("jurisdiction-specific value is 3, generic is 5 → returns 3", async () => {
    const { retentionYears } = await loadRetention();

    const configRows = [
      { jurisdiction: "whs_harmonised", key: "retention_years.inspection", value: 3 },
      { jurisdiction: "generic", key: "retention_years.inspection", value: 5 },
    ];

    expect(retentionYears("inspection", "whs_harmonised", configRows)).toBe(3);
  });
});

describe("retentionYears — generic fallback", () => {
  test("falls back to generic when no jurisdiction-specific row exists", async () => {
    const { retentionYears } = await loadRetention();

    const configRows = [
      { jurisdiction: "generic", key: "retention_years.inspection", value: 5 },
    ];

    // whs_harmonised not in configRows → falls back to generic
    expect(retentionYears("inspection", "whs_harmonised", configRows)).toBe(5);
  });

  test("generic row with value 10 → returns 10", async () => {
    const { retentionYears } = await loadRetention();

    const configRows = [
      { jurisdiction: "generic", key: "retention_years.inspection", value: 10 },
    ];

    expect(retentionYears("inspection", "vic_ohs", configRows)).toBe(10);
  });
});

describe("retentionYears — default fallback (no matching rows)", () => {
  test("returns default 5 when no config rows match", async () => {
    const { retentionYears } = await loadRetention();

    expect(retentionYears("inspection", "vic_ohs", [])).toBe(5);
  });

  test("returns default 5 when config rows exist for different keys", async () => {
    const { retentionYears } = await loadRetention();

    const configRows = [
      { jurisdiction: "vic_ohs", key: "some_other_key", value: 99 },
      { jurisdiction: "generic", key: "another_key", value: 88 },
    ];

    expect(retentionYears("inspection", "vic_ohs", configRows)).toBe(5);
  });

  test("returns default 5 when config rows match a different recordType", async () => {
    const { retentionYears } = await loadRetention();

    const configRows = [
      { jurisdiction: "generic", key: "retention_years.work_order", value: 3 },
    ];

    // "inspection" key not present → default
    expect(retentionYears("inspection", "generic", configRows)).toBe(5);
  });
});

describe("retentionYears — key naming convention", () => {
  test("key is 'retention_years.' + recordType", async () => {
    const { retentionYears } = await loadRetention();

    const configRows = [
      { jurisdiction: "generic", key: "retention_years.work_order", value: 3 },
    ];

    expect(retentionYears("work_order", "generic", configRows)).toBe(3);
  });

  test("different record types use separate keys", async () => {
    const { retentionYears } = await loadRetention();

    const configRows = [
      { jurisdiction: "generic", key: "retention_years.inspection", value: 5 },
      { jurisdiction: "generic", key: "retention_years.work_order", value: 3 },
    ];

    expect(retentionYears("inspection", "generic", configRows)).toBe(5);
    expect(retentionYears("work_order", "generic", configRows)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Helpers for integration tests
// ---------------------------------------------------------------------------

async function seedOrg(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      name: "Retention Test Org",
      slug: `retention-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      plan: "free",
    });

    const userId = await ctx.db.insert("users", {
      orgId,
      name: "Retention Inspector",
      authMethod: "email",
    });

    const templateId = await ctx.db.insert("templates", {
      orgId,
      key: "retention.test_template",
      name: "Retention Test Template",
      category: "safety",
      industry: "construction",
      currentVersion: 1,
      status: "published",
    });

    const templateVersionId = await ctx.db.insert("templateVersions", {
      templateId,
      version: 1,
      sections: [],
      scoringEnabled: false,
    });

    return { orgId, userId, templateId, templateVersionId };
  });
}

/** Insert a completed inspection directly (never call inspections.complete — see CLAUDE.md). */
async function insertCompletedInspection(
  t: ReturnType<typeof convexTest>,
  opts: {
    orgId: string;
    templateId: string;
    templateVersionId: string;
    userId: string;
    completedAt: number;
  },
) {
  return t.run(async (ctx) => {
    return ctx.db.insert("inspections", {
      orgId: opts.orgId as Parameters<typeof ctx.db.insert>[1] extends { orgId: infer O } ? O : never,
      templateId: opts.templateId as Parameters<typeof ctx.db.insert>[1] extends { templateId: infer T } ? T : never,
      templateVersionId: opts.templateVersionId as Parameters<typeof ctx.db.insert>[1] extends { templateVersionId: infer T } ? T : never,
      version: 1,
      inspectorId: opts.userId as Parameters<typeof ctx.db.insert>[1] extends { inspectorId: infer T } ? T : never,
      status: "completed",
      startedAt: opts.completedAt - MS_PER_DAY,
      completedAt: opts.completedAt,
      responses: [],
    });
  });
}

// ---------------------------------------------------------------------------
// records.tryDelete — integration tests
// ---------------------------------------------------------------------------

describe("records.tryDelete — throws within retention period", () => {
  test("throws when inspection was completed yesterday (5-year default retention)", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId, templateId, templateVersionId } = await seedOrg(t);

    const inspectionId = await insertCompletedInspection(t, {
      orgId,
      templateId,
      templateVersionId,
      userId,
      completedAt: NOW - 1 * MS_PER_DAY, // yesterday
    });

    await expect(
      t.mutation(api.records.tryDelete, { inspectionId }),
    ).rejects.toThrow();
  });

  test("throws when inspection was completed 1 year ago (5-year default retention)", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId, templateId, templateVersionId } = await seedOrg(t);

    const inspectionId = await insertCompletedInspection(t, {
      orgId,
      templateId,
      templateVersionId,
      userId,
      completedAt: NOW - 1 * MS_PER_YEAR,
    });

    await expect(
      t.mutation(api.records.tryDelete, { inspectionId }),
    ).rejects.toThrow();
  });

  test("throws when inspection was completed 4 years 364 days ago (just inside 5-year window)", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId, templateId, templateVersionId } = await seedOrg(t);

    const inspectionId = await insertCompletedInspection(t, {
      orgId,
      templateId,
      templateVersionId,
      userId,
      completedAt: NOW - (5 * MS_PER_YEAR - MS_PER_DAY),
    });

    await expect(
      t.mutation(api.records.tryDelete, { inspectionId }),
    ).rejects.toThrow();
  });

  test("error message mentions retention", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId, templateId, templateVersionId } = await seedOrg(t);

    const inspectionId = await insertCompletedInspection(t, {
      orgId,
      templateId,
      templateVersionId,
      userId,
      completedAt: NOW - 1 * MS_PER_DAY,
    });

    let errorMessage = "";
    try {
      await t.mutation(api.records.tryDelete, { inspectionId });
    } catch (e: unknown) {
      errorMessage = e instanceof Error ? e.message : String(e);
    }

    expect(errorMessage.toLowerCase()).toMatch(/retention/);
  });
});

describe("records.tryDelete — succeeds after retention period", () => {
  test("deletes inspection completed more than 5 years ago", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId, templateId, templateVersionId } = await seedOrg(t);

    const inspectionId = await insertCompletedInspection(t, {
      orgId,
      templateId,
      templateVersionId,
      userId,
      completedAt: NOW - (5 * MS_PER_YEAR + MS_PER_DAY), // 5 years + 1 day ago
    });

    // Should not throw
    const result = await t.mutation(api.records.tryDelete, { inspectionId });

    // Returns a success indicator
    expect(result).toMatchObject({ deleted: true });

    // Row is actually gone from the database
    const row = await t.run(async (ctx) => ctx.db.get(inspectionId));
    expect(row).toBeNull();
  });

  test("deletes inspection completed exactly at the 5-year boundary", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId, templateId, templateVersionId } = await seedOrg(t);

    const inspectionId = await insertCompletedInspection(t, {
      orgId,
      templateId,
      templateVersionId,
      userId,
      completedAt: NOW - 5 * MS_PER_YEAR, // exactly 5 years ago
    });

    const result = await t.mutation(api.records.tryDelete, { inspectionId });
    expect(result).toMatchObject({ deleted: true });

    const row = await t.run(async (ctx) => ctx.db.get(inspectionId));
    expect(row).toBeNull();
  });

  test("deletes inspection completed 10 years ago", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId, templateId, templateVersionId } = await seedOrg(t);

    const inspectionId = await insertCompletedInspection(t, {
      orgId,
      templateId,
      templateVersionId,
      userId,
      completedAt: NOW - 10 * MS_PER_YEAR,
    });

    await t.mutation(api.records.tryDelete, { inspectionId });

    const row = await t.run(async (ctx) => ctx.db.get(inspectionId));
    expect(row).toBeNull();
  });
});

describe("records.tryDelete — jurisdictionConfigs override", () => {
  test("respects a jurisdiction-specific retention override (shorter period allows earlier delete)", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId, templateId, templateVersionId } = await seedOrg(t);

    // Seed a jurisdiction config row: generic retention_years.inspection = 1 (year)
    await t.run(async (ctx) => {
      await ctx.db.insert("jurisdictionConfigs", {
        jurisdiction: "generic",
        key: "retention_years.inspection",
        value: 1,
      });
    });

    // Inspection completed 2 years ago — beyond 1-year override → deletable
    const inspectionId = await insertCompletedInspection(t, {
      orgId,
      templateId,
      templateVersionId,
      userId,
      completedAt: NOW - 2 * MS_PER_YEAR,
    });

    const result = await t.mutation(api.records.tryDelete, { inspectionId });
    expect(result).toMatchObject({ deleted: true });

    const row = await t.run(async (ctx) => ctx.db.get(inspectionId));
    expect(row).toBeNull();
  });

  test("respects a jurisdiction-specific retention override (longer period blocks delete)", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId, templateId, templateVersionId } = await seedOrg(t);

    // Seed a jurisdiction config row: generic retention_years.inspection = 10 (years)
    await t.run(async (ctx) => {
      await ctx.db.insert("jurisdictionConfigs", {
        jurisdiction: "generic",
        key: "retention_years.inspection",
        value: 10,
      });
    });

    // Inspection completed 6 years ago — within 10-year override → NOT deletable
    const inspectionId = await insertCompletedInspection(t, {
      orgId,
      templateId,
      templateVersionId,
      userId,
      completedAt: NOW - 6 * MS_PER_YEAR,
    });

    await expect(
      t.mutation(api.records.tryDelete, { inspectionId }),
    ).rejects.toThrow();
  });
});

describe("records.tryDelete — non-existent inspection", () => {
  test("throws when inspectionId does not exist in the database", async () => {
    const t = convexTest(schema, modules);
    const { orgId } = await seedOrg(t);

    // Use the orgId as a fake inspectionId — valid id format but wrong table
    await expect(
      t.mutation(api.records.tryDelete, {
        inspectionId: orgId as unknown as string,
      }),
    ).rejects.toThrow();
  });
});

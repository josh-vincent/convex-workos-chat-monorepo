/**
 * Tests for Config-driven jurisdiction (spec §11, DoD #9).
 *
 * Intended API (to be implemented):
 *
 *  convex/schema.ts — additive/backward-compatible additions:
 *    `jurisdictionConfigs` table:
 *      jurisdiction: v.union(v.literal("vic_ohs"), v.literal("whs_harmonised"), v.literal("generic"))
 *      key: v.string()
 *      value: v.any()
 *      Index by_jurisdiction_key on ["jurisdiction", "key"]
 *    `templates` gains OPTIONAL field:
 *      jurisdiction: v.optional(v.union(v.literal("vic_ohs"), v.literal("whs_harmonised"), v.literal("generic")))
 *    `organizations` gains OPTIONAL field:
 *      jurisdiction: v.optional(v.union(v.literal("vic_ohs"), v.literal("whs_harmonised"), v.literal("generic")))
 *
 *  convex/jurisdiction.ts:
 *    `jurisdiction.seedDefaults()` — idempotent mutation that inserts:
 *      { jurisdiction: "vic_ohs",         key: "principal_contractor_threshold",  value: 350000 }
 *      { jurisdiction: "vic_ohs",         key: "notifiable_incident_window_hours", value: 48     }
 *      { jurisdiction: "generic",         key: "swms_review_default_days",         value: 365    }
 *      (More rows are fine; at minimum these three must be present after a call.)
 *
 *    `jurisdiction.getThreshold({ jurisdiction, key })` — query that:
 *      1. Looks up (jurisdiction, key) in jurisdictionConfigs.
 *      2. Falls back to ("generic", key) if the specific jurisdiction has no row.
 *      3. Returns null if neither exists.
 *
 * convex-test safe:
 *  - seedDefaults is a plain mutation (ctx.db.insert only, idempotent).
 *  - getThreshold is a plain query (ctx.db reads only).
 *  - No component calls, no workflow.start, no scoreByOrg/scoreBySite.
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
// jurisdiction.seedDefaults
// ---------------------------------------------------------------------------

describe("jurisdiction.seedDefaults", () => {
  test("inserts the mandatory default rows on first call", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.jurisdiction.seedDefaults, {});

    // Verify the three mandatory rows are present via direct db reads.
    const rows = await t.run(async (ctx) => {
      return ctx.db.query("jurisdictionConfigs").collect();
    });

    const find = (jurisdiction: string, key: string) =>
      rows.find((r) => r.jurisdiction === jurisdiction && r.key === key);

    const pc = find("vic_ohs", "principal_contractor_threshold");
    expect(pc).toBeDefined();
    expect(pc!.value).toBe(350000);

    const nw = find("vic_ohs", "notifiable_incident_window_hours");
    expect(nw).toBeDefined();
    expect(nw!.value).toBe(48);

    const sr = find("generic", "swms_review_default_days");
    expect(sr).toBeDefined();
    expect(sr!.value).toBe(365);
  });

  test("is idempotent — calling twice does not duplicate rows", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.jurisdiction.seedDefaults, {});
    await t.mutation(api.jurisdiction.seedDefaults, {});

    const rows = await t.run(async (ctx) => {
      return ctx.db.query("jurisdictionConfigs").collect();
    });

    // Count rows for each (jurisdiction, key) pair — none should appear more than once.
    const countPc = rows.filter(
      (r) =>
        r.jurisdiction === "vic_ohs" &&
        r.key === "principal_contractor_threshold",
    ).length;
    expect(countPc).toBe(1);

    const countNw = rows.filter(
      (r) =>
        r.jurisdiction === "vic_ohs" &&
        r.key === "notifiable_incident_window_hours",
    ).length;
    expect(countNw).toBe(1);

    const countSr = rows.filter(
      (r) =>
        r.jurisdiction === "generic" && r.key === "swms_review_default_days",
    ).length;
    expect(countSr).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// jurisdiction.getThreshold — exact jurisdiction match
// ---------------------------------------------------------------------------

describe("jurisdiction.getThreshold — exact match", () => {
  test("vic_ohs + principal_contractor_threshold returns 350000 after seedDefaults", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.jurisdiction.seedDefaults, {});

    const value = await t.query(api.jurisdiction.getThreshold, {
      jurisdiction: "vic_ohs",
      key: "principal_contractor_threshold",
    });

    expect(value).toBe(350000);
  });

  test("vic_ohs + notifiable_incident_window_hours returns 48 after seedDefaults", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.jurisdiction.seedDefaults, {});

    const value = await t.query(api.jurisdiction.getThreshold, {
      jurisdiction: "vic_ohs",
      key: "notifiable_incident_window_hours",
    });

    expect(value).toBe(48);
  });

  test("generic + swms_review_default_days returns 365 after seedDefaults", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.jurisdiction.seedDefaults, {});

    const value = await t.query(api.jurisdiction.getThreshold, {
      jurisdiction: "generic",
      key: "swms_review_default_days",
    });

    expect(value).toBe(365);
  });
});

// ---------------------------------------------------------------------------
// jurisdiction.getThreshold — fallback to generic
// ---------------------------------------------------------------------------

describe("jurisdiction.getThreshold — fallback to generic", () => {
  test("whs_harmonised + swms_review_default_days falls back to generic row (365)", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.jurisdiction.seedDefaults, {});

    // whs_harmonised has no override for swms_review_default_days,
    // so it should fall back to the generic row → 365.
    const value = await t.query(api.jurisdiction.getThreshold, {
      jurisdiction: "whs_harmonised",
      key: "swms_review_default_days",
    });

    expect(value).toBe(365);
  });

  test("whs_harmonised overrides a key when an explicit row exists", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.jurisdiction.seedDefaults, {});

    // Manually insert a whs_harmonised override.
    await t.run(async (ctx) => {
      await ctx.db.insert("jurisdictionConfigs", {
        jurisdiction: "whs_harmonised",
        key: "principal_contractor_threshold",
        value: 500000,
      });
    });

    const value = await t.query(api.jurisdiction.getThreshold, {
      jurisdiction: "whs_harmonised",
      key: "principal_contractor_threshold",
    });

    // Must return the specific row (500000), NOT the generic fallback.
    expect(value).toBe(500000);
    expect(value).not.toBe(350000);
  });

  test("jurisdiction-specific row takes precedence over generic row", async () => {
    const t = convexTest(schema, modules);

    // Insert a generic row and a specific vic_ohs override for the same key.
    await t.run(async (ctx) => {
      await ctx.db.insert("jurisdictionConfigs", {
        jurisdiction: "generic",
        key: "test_threshold",
        value: 100,
      });
      await ctx.db.insert("jurisdictionConfigs", {
        jurisdiction: "vic_ohs",
        key: "test_threshold",
        value: 999,
      });
    });

    const value = await t.query(api.jurisdiction.getThreshold, {
      jurisdiction: "vic_ohs",
      key: "test_threshold",
    });

    // vic_ohs-specific row wins over generic.
    expect(value).toBe(999);
  });

  test("whs_harmonised + principal_contractor_threshold falls back to generic (no whs override seeded)", async () => {
    const t = convexTest(schema, modules);

    // seedDefaults provides vic_ohs=350000 for principal_contractor_threshold
    // but no whs_harmonised override. If there is also a generic row for this
    // key we expect that; if seedDefaults only provides a vic_ohs row and no
    // generic one, expect null.
    // The spec says "falls back to generic (or null) per the rule" — test null case explicitly:
    await t.run(async (ctx) => {
      // Only insert a vic_ohs row — no generic row.
      await ctx.db.insert("jurisdictionConfigs", {
        jurisdiction: "vic_ohs",
        key: "only_in_vic",
        value: 777,
      });
    });

    const value = await t.query(api.jurisdiction.getThreshold, {
      jurisdiction: "whs_harmonised",
      key: "only_in_vic",
    });

    // whs_harmonised has no row; generic has no row either → null.
    expect(value).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// jurisdiction.getThreshold — unknown key
// ---------------------------------------------------------------------------

describe("jurisdiction.getThreshold — unknown key", () => {
  test("any jurisdiction + unknown key returns null (no rows exist)", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.jurisdiction.seedDefaults, {});

    const value = await t.query(api.jurisdiction.getThreshold, {
      jurisdiction: "vic_ohs",
      key: "completely_unknown_key_xyzzy",
    });

    expect(value).toBeNull();
  });

  test("whs_harmonised + unknown key returns null", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.jurisdiction.seedDefaults, {});

    const value = await t.query(api.jurisdiction.getThreshold, {
      jurisdiction: "whs_harmonised",
      key: "no_such_key_abc",
    });

    expect(value).toBeNull();
  });

  test("generic + unknown key returns null", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.jurisdiction.seedDefaults, {});

    const value = await t.query(api.jurisdiction.getThreshold, {
      jurisdiction: "generic",
      key: "no_such_key_abc",
    });

    expect(value).toBeNull();
  });

  test("returns null even when NO rows have been seeded at all", async () => {
    const t = convexTest(schema, modules);

    // Do NOT call seedDefaults — table is empty.
    const value = await t.query(api.jurisdiction.getThreshold, {
      jurisdiction: "vic_ohs",
      key: "principal_contractor_threshold",
    });

    expect(value).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// jurisdictionConfigs table — direct schema validation
// ---------------------------------------------------------------------------

describe("jurisdictionConfigs table — direct inserts (schema smoke)", () => {
  test("can insert and read back a vic_ohs row directly", async () => {
    const t = convexTest(schema, modules);

    const id = await t.run(async (ctx) => {
      return ctx.db.insert("jurisdictionConfigs", {
        jurisdiction: "vic_ohs",
        key: "some_key",
        value: 42,
      });
    });

    const row = await t.run(async (ctx) => ctx.db.get(id));

    expect(row).not.toBeNull();
    expect(row!.jurisdiction).toBe("vic_ohs");
    expect(row!.key).toBe("some_key");
    expect(row!.value).toBe(42);
  });

  test("can insert a whs_harmonised row with a string value", async () => {
    const t = convexTest(schema, modules);

    const id = await t.run(async (ctx) => {
      return ctx.db.insert("jurisdictionConfigs", {
        jurisdiction: "whs_harmonised",
        key: "string_value_key",
        value: "some text",
      });
    });

    const row = await t.run(async (ctx) => ctx.db.get(id));

    expect(row).not.toBeNull();
    expect(row!.value).toBe("some text");
  });

  test("can insert a generic row with a boolean value", async () => {
    const t = convexTest(schema, modules);

    const id = await t.run(async (ctx) => {
      return ctx.db.insert("jurisdictionConfigs", {
        jurisdiction: "generic",
        key: "bool_key",
        value: true,
      });
    });

    const row = await t.run(async (ctx) => ctx.db.get(id));

    expect(row).not.toBeNull();
    expect(row!.value).toBe(true);
  });

  test("by_jurisdiction_key index returns only matching rows", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      await ctx.db.insert("jurisdictionConfigs", {
        jurisdiction: "vic_ohs",
        key: "target_key",
        value: 111,
      });
      await ctx.db.insert("jurisdictionConfigs", {
        jurisdiction: "vic_ohs",
        key: "other_key",
        value: 222,
      });
      await ctx.db.insert("jurisdictionConfigs", {
        jurisdiction: "generic",
        key: "target_key",
        value: 333,
      });
    });

    const results = await t.run(async (ctx) => {
      return ctx.db
        .query("jurisdictionConfigs")
        .withIndex("by_jurisdiction_key", (q) =>
          q.eq("jurisdiction", "vic_ohs").eq("key", "target_key"),
        )
        .collect();
    });

    expect(results.length).toBe(1);
    expect(results[0].value).toBe(111);
  });
});

/**
 * Tests for Register entries + derived currency status (spec §5.3, DoD #4).
 *
 * Intended API (to be implemented):
 *  - convex/lib/currency.ts: `currencyStatus(entry, nowMs, defaultLeadDays)` → CurrencyStatus
 *      where CurrencyStatus = "current" | "expiring_soon" | "expired" | "missing" | "review_due"
 *      Rules:
 *        - no expiresAt AND no reviewEveryDays AND required → "missing"
 *        - expiresAt < nowMs → "expired"
 *        - expiresAt - nowMs <= (entry.leadTimeDays ?? defaultLeadDays) * MS_PER_DAY → "expiring_soon"
 *        - reviewEveryDays elapsed since issuedAt (issuedAt + reviewEveryDays*MS_PER_DAY <= nowMs) → "review_due"
 *        - else → "current"
 *  - convex/schema.ts: `registerEntries` table with fields:
 *      orgId, registerType (union: licence|competency|sds|insurance|plant|induction),
 *      anchorType (union: person|site|asset|subcontractor), anchorId (string), label,
 *      identifier?, issuedAt?, expiresAt?, reviewEveryDays?, leadTimeDays?,
 *      documentRef?(id media), verifiedBy?(id users)
 *      Indexes: by_org (orgId), by_anchor (anchorType, anchorId)
 *  - convex/registers.ts: `registers.upsert(args)` → id
 *  - convex/registers.ts: `registers.list({ orgId })` → entries WITH derived `status` field
 *
 * convex-test safe: currencyStatus unit tests are pure (no Convex); upsert/list tests
 * only do ctx.db reads/writes — no component calls, no workflow.start.
 */
import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

// ---------------------------------------------------------------------------
// currencyStatus — pure unit tests (imported directly, no Convex harness needed)
// ---------------------------------------------------------------------------

// We import dynamically so a missing file produces a clear "module not found"
// error (the right red failure) rather than a TypeScript compile error.

async function loadCurrencyStatus() {
  const mod = await import("./lib/currency");
  return mod.currencyStatus as (
    entry: {
      expiresAt?: number;
      issuedAt?: number;
      reviewEveryDays?: number;
      leadTimeDays?: number;
      required?: boolean;
    },
    nowMs: number,
    defaultLeadDays: number,
  ) => "current" | "expiring_soon" | "expired" | "missing" | "review_due";
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Reference "now" for all pure tests: 2026-01-15T00:00:00.000Z
const NOW = new Date("2026-01-15T00:00:00.000Z").getTime();
const DEFAULT_LEAD = 30; // days

describe("currencyStatus — missing", () => {
  test("no expiresAt + no reviewEveryDays + required=true → missing", async () => {
    const fn = await loadCurrencyStatus();
    expect(fn({ required: true }, NOW, DEFAULT_LEAD)).toBe("missing");
  });

  test("no expiresAt + no reviewEveryDays + required=false → current (not required, nothing to track)", async () => {
    const fn = await loadCurrencyStatus();
    // Not required and no dates — treat as current (no obligation exists)
    expect(fn({ required: false }, NOW, DEFAULT_LEAD)).toBe("current");
  });

  test("no expiresAt + no reviewEveryDays + required=undefined → missing (default to required)", async () => {
    const fn = await loadCurrencyStatus();
    // Omitting required should default to treating the entry as required → missing
    expect(fn({}, NOW, DEFAULT_LEAD)).toBe("missing");
  });
});

describe("currencyStatus — expired", () => {
  test("expiresAt 1 ms before now → expired", async () => {
    const fn = await loadCurrencyStatus();
    expect(fn({ expiresAt: NOW - 1 }, NOW, DEFAULT_LEAD)).toBe("expired");
  });

  test("expiresAt exactly at now → expired (boundary: now, not in the future)", async () => {
    const fn = await loadCurrencyStatus();
    expect(fn({ expiresAt: NOW }, NOW, DEFAULT_LEAD)).toBe("expired");
  });

  test("expiresAt 30 days in the past → expired", async () => {
    const fn = await loadCurrencyStatus();
    expect(fn({ expiresAt: NOW - 30 * MS_PER_DAY }, NOW, DEFAULT_LEAD)).toBe("expired");
  });
});

describe("currencyStatus — expiring_soon", () => {
  test("expiresAt exactly defaultLeadDays from now → expiring_soon (boundary)", async () => {
    const fn = await loadCurrencyStatus();
    // expiresAt - now == defaultLeadDays * MS_PER_DAY  → still within lead window
    const expiresAt = NOW + DEFAULT_LEAD * MS_PER_DAY;
    expect(fn({ expiresAt }, NOW, DEFAULT_LEAD)).toBe("expiring_soon");
  });

  test("expiresAt 1 ms inside the lead window → expiring_soon", async () => {
    const fn = await loadCurrencyStatus();
    const expiresAt = NOW + DEFAULT_LEAD * MS_PER_DAY - 1;
    expect(fn({ expiresAt }, NOW, DEFAULT_LEAD)).toBe("expiring_soon");
  });

  test("entry.leadTimeDays overrides defaultLeadDays", async () => {
    const fn = await loadCurrencyStatus();
    // 60-day custom lead; expiresAt is 45 days away → expiring_soon
    const expiresAt = NOW + 45 * MS_PER_DAY;
    expect(fn({ expiresAt, leadTimeDays: 60 }, NOW, DEFAULT_LEAD)).toBe("expiring_soon");
  });

  test("expiresAt just outside the lead window → current (not expiring_soon yet)", async () => {
    const fn = await loadCurrencyStatus();
    // expiresAt - now == defaultLeadDays * MS_PER_DAY + 1 ms → just outside window
    const expiresAt = NOW + DEFAULT_LEAD * MS_PER_DAY + 1;
    expect(fn({ expiresAt }, NOW, DEFAULT_LEAD)).toBe("current");
  });
});

describe("currencyStatus — review_due", () => {
  test("issuedAt + reviewEveryDays*MS_PER_DAY <= nowMs → review_due", async () => {
    const fn = await loadCurrencyStatus();
    // Issued 365 days ago, review every 365 days — exactly due today
    const issuedAt = NOW - 365 * MS_PER_DAY;
    expect(fn({ issuedAt, reviewEveryDays: 365 }, NOW, DEFAULT_LEAD)).toBe("review_due");
  });

  test("issuedAt + reviewEveryDays*MS_PER_DAY < nowMs → review_due (overdue)", async () => {
    const fn = await loadCurrencyStatus();
    // Issued 400 days ago, review every 365 days — 35 days overdue
    const issuedAt = NOW - 400 * MS_PER_DAY;
    expect(fn({ issuedAt, reviewEveryDays: 365 }, NOW, DEFAULT_LEAD)).toBe("review_due");
  });

  test("review not yet elapsed → current", async () => {
    const fn = await loadCurrencyStatus();
    // Issued 100 days ago, review every 365 days — 265 days remain
    const issuedAt = NOW - 100 * MS_PER_DAY;
    expect(fn({ issuedAt, reviewEveryDays: 365 }, NOW, DEFAULT_LEAD)).toBe("current");
  });

  test("expired takes priority over review_due", async () => {
    const fn = await loadCurrencyStatus();
    // Expired AND review overdue — expired should win
    const issuedAt = NOW - 400 * MS_PER_DAY;
    const expiresAt = NOW - 10 * MS_PER_DAY;
    expect(fn({ issuedAt, expiresAt, reviewEveryDays: 365 }, NOW, DEFAULT_LEAD)).toBe("expired");
  });

  test("expiring_soon takes priority over review_due", async () => {
    const fn = await loadCurrencyStatus();
    // Expiring in 10 days (within 30-day lead) AND review overdue — expiring_soon wins
    const issuedAt = NOW - 400 * MS_PER_DAY;
    const expiresAt = NOW + 10 * MS_PER_DAY;
    expect(fn({ issuedAt, expiresAt, reviewEveryDays: 365 }, NOW, DEFAULT_LEAD)).toBe("expiring_soon");
  });
});

describe("currencyStatus — current", () => {
  test("future expiresAt outside lead window, no review overdue → current", async () => {
    const fn = await loadCurrencyStatus();
    const expiresAt = NOW + 180 * MS_PER_DAY;
    expect(fn({ expiresAt }, NOW, DEFAULT_LEAD)).toBe("current");
  });

  test("has issuedAt but no reviewEveryDays, future expiresAt → current", async () => {
    const fn = await loadCurrencyStatus();
    const issuedAt = NOW - 90 * MS_PER_DAY;
    const expiresAt = NOW + 180 * MS_PER_DAY;
    expect(fn({ issuedAt, expiresAt }, NOW, DEFAULT_LEAD)).toBe("current");
  });
});

// ---------------------------------------------------------------------------
// Same glob exclusions as smoke.test.ts
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
// Helpers
// ---------------------------------------------------------------------------

async function seedOrg(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    return ctx.db.insert("organizations", {
      name: "Register Test Org",
      slug: "register-test-org",
      plan: "free",
    });
  });
}

// ---------------------------------------------------------------------------
// registers.upsert
// ---------------------------------------------------------------------------

describe("registers.upsert", () => {
  test("creates a new entry and returns a string id", async () => {
    const t = convexTest(schema, modules);
    const orgId = await seedOrg(t);

    const id = await t.mutation(api.registers.upsert, {
      orgId,
      registerType: "licence",
      anchorType: "person",
      anchorId: "person-abc-123",
      label: "Forklift Licence",
    });

    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  test("upsert with full optional fields stores them", async () => {
    const t = convexTest(schema, modules);
    const orgId = await seedOrg(t);

    const issuedAt = NOW - 90 * MS_PER_DAY;
    const expiresAt = NOW + 275 * MS_PER_DAY;

    const id = await t.mutation(api.registers.upsert, {
      orgId,
      registerType: "competency",
      anchorType: "person",
      anchorId: "person-xyz-456",
      label: "Working at Heights",
      identifier: "WAH-2025-001",
      issuedAt,
      expiresAt,
      reviewEveryDays: 365,
      leadTimeDays: 60,
    });

    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row).not.toBeNull();
    expect(row!.label).toBe("Working at Heights");
    expect(row!.identifier).toBe("WAH-2025-001");
    expect(row!.issuedAt).toBe(issuedAt);
    expect(row!.expiresAt).toBe(expiresAt);
    expect(row!.reviewEveryDays).toBe(365);
    expect(row!.leadTimeDays).toBe(60);
  });

  test("second upsert with same orgId+anchorType+anchorId+registerType updates in place", async () => {
    const t = convexTest(schema, modules);
    const orgId = await seedOrg(t);

    const args = {
      orgId,
      registerType: "insurance" as const,
      anchorType: "subcontractor" as const,
      anchorId: "sub-001",
      label: "Public Liability Insurance",
    };

    const id1 = await t.mutation(api.registers.upsert, args);
    const id2 = await t.mutation(api.registers.upsert, {
      ...args,
      label: "Public Liability Insurance (renewed)",
      expiresAt: NOW + 365 * MS_PER_DAY,
    });

    // Should be same document
    expect(id2).toBe(id1);

    const row = await t.run(async (ctx) => ctx.db.get(id1));
    expect(row!.label).toBe("Public Liability Insurance (renewed)");
    expect(row!.expiresAt).toBe(NOW + 365 * MS_PER_DAY);
  });

  test("different anchorIds produce separate entries", async () => {
    const t = convexTest(schema, modules);
    const orgId = await seedOrg(t);

    const id1 = await t.mutation(api.registers.upsert, {
      orgId,
      registerType: "induction",
      anchorType: "person",
      anchorId: "person-A",
      label: "Site Induction",
    });

    const id2 = await t.mutation(api.registers.upsert, {
      orgId,
      registerType: "induction",
      anchorType: "person",
      anchorId: "person-B",
      label: "Site Induction",
    });

    expect(id1).not.toBe(id2);
  });
});

// ---------------------------------------------------------------------------
// registers.list — derived status
// ---------------------------------------------------------------------------

describe("registers.list — derived currency status", () => {
  test("returns entries for the given org", async () => {
    const t = convexTest(schema, modules);
    const orgId = await seedOrg(t);

    await t.mutation(api.registers.upsert, {
      orgId,
      registerType: "sds",
      anchorType: "site",
      anchorId: "site-001",
      label: "Safety Data Sheet — Hydraulic Oil",
    });

    const results = await t.query(api.registers.list, { orgId });
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(1);
    expect(results[0].label).toBe("Safety Data Sheet — Hydraulic Oil");
  });

  test("each entry has a derived status field (never stored)", async () => {
    const t = convexTest(schema, modules);
    const orgId = await seedOrg(t);

    await t.mutation(api.registers.upsert, {
      orgId,
      registerType: "plant",
      anchorType: "asset",
      anchorId: "asset-001",
      label: "Plant Registration",
      expiresAt: Date.now() + 200 * MS_PER_DAY,
    });

    const results = await t.query(api.registers.list, { orgId });
    expect(results.length).toBe(1);
    const entry = results[0];

    // status must be present and be one of the valid values
    expect(["current", "expiring_soon", "expired", "missing", "review_due"]).toContain(entry.status);

    // status must NOT be stored as a DB field (the stored row should not have it)
    const raw = await t.run(async (ctx) => ctx.db.get(entry._id));
    expect((raw as Record<string, unknown>).status).toBeUndefined();
  });

  test("entry without expiresAt/reviewEveryDays gets status 'missing'", async () => {
    const t = convexTest(schema, modules);
    const orgId = await seedOrg(t);

    await t.mutation(api.registers.upsert, {
      orgId,
      registerType: "licence",
      anchorType: "person",
      anchorId: "person-no-expiry",
      label: "Missing Licence",
      // no issuedAt, no expiresAt, no reviewEveryDays
    });

    const results = await t.query(api.registers.list, { orgId });
    expect(results[0].status).toBe("missing");
  });

  test("entry with past expiresAt gets status 'expired'", async () => {
    const t = convexTest(schema, modules);
    const orgId = await seedOrg(t);

    await t.mutation(api.registers.upsert, {
      orgId,
      registerType: "licence",
      anchorType: "person",
      anchorId: "person-expired",
      label: "Expired Licence",
      expiresAt: Date.now() - 10 * MS_PER_DAY,
    });

    const results = await t.query(api.registers.list, { orgId });
    expect(results[0].status).toBe("expired");
  });

  test("entry expiring within defaultLeadDays gets status 'expiring_soon'", async () => {
    const t = convexTest(schema, modules);
    const orgId = await seedOrg(t);

    // Expiring in 7 days — well within any reasonable default lead window
    await t.mutation(api.registers.upsert, {
      orgId,
      registerType: "insurance",
      anchorType: "subcontractor",
      anchorId: "sub-expiring",
      label: "Expiring Insurance",
      expiresAt: Date.now() + 7 * MS_PER_DAY,
    });

    const results = await t.query(api.registers.list, { orgId });
    expect(results[0].status).toBe("expiring_soon");
  });

  test("entry with future expiresAt well outside lead window gets status 'current'", async () => {
    const t = convexTest(schema, modules);
    const orgId = await seedOrg(t);

    await t.mutation(api.registers.upsert, {
      orgId,
      registerType: "competency",
      anchorType: "person",
      anchorId: "person-current",
      label: "Current Competency",
      expiresAt: Date.now() + 365 * MS_PER_DAY,
    });

    const results = await t.query(api.registers.list, { orgId });
    expect(results[0].status).toBe("current");
  });

  test("does not return entries for a different org", async () => {
    const t = convexTest(schema, modules);
    const orgA = await seedOrg(t);
    const orgB = await t.run(async (ctx) =>
      ctx.db.insert("organizations", {
        name: "Other Org",
        slug: "other-org",
        plan: "free",
      }),
    );

    await t.mutation(api.registers.upsert, {
      orgId: orgA,
      registerType: "licence",
      anchorType: "person",
      anchorId: "person-A",
      label: "Org A Licence",
    });

    const results = await t.query(api.registers.list, { orgId: orgB });
    expect(results).toEqual([]);
  });
});

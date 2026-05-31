/**
 * Tests for the Daily Currency Sweep + Alerts feature (spec §6, DoD #5).
 *
 * Intended API (to be implemented):
 *
 *  convex/schema.ts — additive changes (backward-compatible):
 *    `alerts` table:
 *      orgId (id organizations), kind (union expiring_soon|expired|overdue|review_due),
 *      severity (union low|medium|high|critical),
 *      registerEntryId? (id registerEntries), inspectionId? (id inspections),
 *      message (string), status (union open|acknowledged|resolved), createdAt (number).
 *      Index by_org on ["orgId"].
 *      Index by_entry_kind on ["registerEntryId","kind"] (dedupe).
 *
 *  convex/currency.ts — exported public API:
 *    `currency.sweep({ orgId, nowMs, defaultLeadDays? })` (mutation) → { created: number }
 *      - Scans registerEntries for the org.
 *      - Calls currencyStatus(entry, nowMs, defaultLeadDays ?? 30) for each entry.
 *      - For statuses expiring_soon / expired / review_due: inserts an alert with that
 *        kind IF no open alert for that (registerEntryId, kind) pair already exists
 *        (idempotent via by_entry_kind index).
 *      - Severity mapping (implementer's call; tests assert severity is present + valid):
 *        expired → critical, expiring_soon → high, review_due → medium.
 *      - Also scans inspections for the org where dueAt < nowMs AND status in
 *        (in_progress | scheduled) and raises kind="overdue" alerts (idempotent on
 *        (inspectionId, kind)).
 *      - Returns { created: number } — count of NEW alerts inserted this run.
 *
 *    `currency.list({ orgId })` (query) → Alert[]
 *      - Returns all alerts for the org ordered by createdAt desc (or any stable order).
 *
 * convex-test safe:
 *  - sweep is a plain mutation — no component calls, no workflow.start.
 *  - list is a plain query.
 *  - All seeds use ctx.db.insert directly.
 *  - inspections.start is NOT called (see CLAUDE.md) — inspections are seeded via ctx.db.
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

// Fixed "now" for deterministic tests — 2026-03-01T00:00:00.000Z
const NOW = new Date("2026-03-01T00:00:00.000Z").getTime();
const DEFAULT_LEAD_DAYS = 30;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Seed the minimal org + template + templateVersion rows needed for inspections. */
async function seedOrg(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      name: "Sweep Test Org",
      slug: `sweep-test-org-${Date.now()}`,
      plan: "free",
    });

    const userId = await ctx.db.insert("users", {
      orgId,
      name: "Inspector Bot",
      authMethod: "email",
    });

    const templateId = await ctx.db.insert("templates", {
      orgId,
      key: "sweep.test_template",
      name: "Sweep Test Template",
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

/** Insert a registerEntry directly (bypasses registers.upsert to avoid side effects). */
async function insertRegisterEntry(
  t: ReturnType<typeof convexTest>,
  orgId: string,
  overrides: {
    expiresAt?: number;
    issuedAt?: number;
    reviewEveryDays?: number;
    leadTimeDays?: number;
    label?: string;
  } = {},
) {
  return t.run(async (ctx) => {
    return ctx.db.insert("registerEntries", {
      orgId: orgId as Parameters<typeof ctx.db.insert>[1] extends { orgId: infer O } ? O : never,
      registerType: "licence",
      anchorType: "person",
      anchorId: `person-${Math.random().toString(36).slice(2)}`,
      label: overrides.label ?? "Test Licence",
      ...overrides,
    });
  });
}

/** Insert an inspection row directly (never call inspections.start in tests — see CLAUDE.md). */
async function insertInspection(
  t: ReturnType<typeof convexTest>,
  orgId: string,
  opts: {
    status: "in_progress" | "completed" | "submitted";
    dueAt?: number;
    templateId: string;
    templateVersionId: string;
    userId: string;
  },
) {
  return t.run(async (ctx) => {
    return ctx.db.insert("inspections", {
      orgId: orgId as Parameters<typeof ctx.db.insert>[1] extends { orgId: infer O } ? O : never,
      templateId: opts.templateId as Parameters<typeof ctx.db.insert>[1] extends { templateId: infer T } ? T : never,
      templateVersionId: opts.templateVersionId as Parameters<typeof ctx.db.insert>[1] extends { templateVersionId: infer T } ? T : never,
      version: 1,
      inspectorId: opts.userId as Parameters<typeof ctx.db.insert>[1] extends { inspectorId: infer T } ? T : never,
      status: opts.status,
      startedAt: NOW - 2 * MS_PER_DAY,
      responses: [],
      ...(opts.dueAt !== undefined ? { dueAt: opts.dueAt } : {}),
    });
  });
}

// ---------------------------------------------------------------------------
// currency.sweep — register entry alerts
// ---------------------------------------------------------------------------

describe("currency.sweep — register entry alerts", () => {
  test("returns { created: 0 } when org has no register entries", async () => {
    const t = convexTest(schema, modules);
    const { orgId } = await seedOrg(t);

    const result = await t.mutation(api.currency.sweep, {
      orgId,
      nowMs: NOW,
    });

    expect(result).toEqual({ created: 0 });
  });

  test("creates an 'expired' alert for an entry with expiresAt in the past", async () => {
    const t = convexTest(schema, modules);
    const { orgId } = await seedOrg(t);

    await insertRegisterEntry(t, orgId, {
      expiresAt: NOW - 10 * MS_PER_DAY, // expired 10 days ago
      label: "Expired Licence",
    });

    const result = await t.mutation(api.currency.sweep, {
      orgId,
      nowMs: NOW,
    });

    expect(result.created).toBe(1);

    const alerts = await t.query(api.currency.list, { orgId });
    expect(alerts.length).toBe(1);
    expect(alerts[0].kind).toBe("expired");
    expect(alerts[0].status).toBe("open");
    expect(alerts[0].orgId).toBe(orgId);
    expect(typeof alerts[0].message).toBe("string");
    expect(alerts[0].message.length).toBeGreaterThan(0);
    // severity must be one of the valid union values
    expect(["low", "medium", "high", "critical"]).toContain(alerts[0].severity);
  });

  test("creates an 'expiring_soon' alert for an entry expiring within the lead window", async () => {
    const t = convexTest(schema, modules);
    const { orgId } = await seedOrg(t);

    await insertRegisterEntry(t, orgId, {
      expiresAt: NOW + 7 * MS_PER_DAY, // expiring in 7 days (within 30-day default lead)
      label: "Expiring Soon Licence",
    });

    const result = await t.mutation(api.currency.sweep, {
      orgId,
      nowMs: NOW,
    });

    expect(result.created).toBe(1);

    const alerts = await t.query(api.currency.list, { orgId });
    expect(alerts.length).toBe(1);
    expect(alerts[0].kind).toBe("expiring_soon");
    expect(alerts[0].status).toBe("open");
  });

  test("creates a 'review_due' alert for an entry whose review period has elapsed", async () => {
    const t = convexTest(schema, modules);
    const { orgId } = await seedOrg(t);

    await insertRegisterEntry(t, orgId, {
      issuedAt: NOW - 400 * MS_PER_DAY, // issued 400 days ago
      reviewEveryDays: 365,             // review due after 365 days → overdue by 35 days
      label: "Review Due Licence",
    });

    const result = await t.mutation(api.currency.sweep, {
      orgId,
      nowMs: NOW,
    });

    expect(result.created).toBe(1);

    const alerts = await t.query(api.currency.list, { orgId });
    expect(alerts.length).toBe(1);
    expect(alerts[0].kind).toBe("review_due");
    expect(alerts[0].status).toBe("open");
  });

  test("does NOT create an alert for a 'current' entry", async () => {
    const t = convexTest(schema, modules);
    const { orgId } = await seedOrg(t);

    await insertRegisterEntry(t, orgId, {
      expiresAt: NOW + 180 * MS_PER_DAY, // expires in 6 months — current
      label: "Current Licence",
    });

    const result = await t.mutation(api.currency.sweep, {
      orgId,
      nowMs: NOW,
    });

    expect(result.created).toBe(0);
    const alerts = await t.query(api.currency.list, { orgId });
    expect(alerts).toEqual([]);
  });

  test("does NOT create an alert for a 'missing' entry (no expiry tracking)", async () => {
    const t = convexTest(schema, modules);
    const { orgId } = await seedOrg(t);

    // No expiresAt, no reviewEveryDays → status="missing" — sweep does NOT alert on missing
    await insertRegisterEntry(t, orgId, {
      label: "Missing Licence",
    });

    const result = await t.mutation(api.currency.sweep, {
      orgId,
      nowMs: NOW,
    });

    // Missing does not map to any alert kind per the spec (only expiring_soon/expired/review_due)
    expect(result.created).toBe(0);
  });

  test("handles multiple entries producing different alert kinds in one sweep", async () => {
    const t = convexTest(schema, modules);
    const { orgId } = await seedOrg(t);

    // Entry 1: expired
    await insertRegisterEntry(t, orgId, {
      expiresAt: NOW - 5 * MS_PER_DAY,
      label: "Expired Entry",
    });

    // Entry 2: expiring_soon
    await insertRegisterEntry(t, orgId, {
      expiresAt: NOW + 10 * MS_PER_DAY,
      label: "Expiring Soon Entry",
    });

    // Entry 3: review_due
    await insertRegisterEntry(t, orgId, {
      issuedAt: NOW - 400 * MS_PER_DAY,
      reviewEveryDays: 365,
      label: "Review Due Entry",
    });

    // Entry 4: current — no alert
    await insertRegisterEntry(t, orgId, {
      expiresAt: NOW + 200 * MS_PER_DAY,
      label: "Current Entry",
    });

    const result = await t.mutation(api.currency.sweep, { orgId, nowMs: NOW });

    expect(result.created).toBe(3);

    const alerts = await t.query(api.currency.list, { orgId });
    expect(alerts.length).toBe(3);

    const kinds = alerts.map((a: { kind: string }) => a.kind).sort();
    expect(kinds).toEqual(["expired", "expiring_soon", "review_due"].sort());
  });

  test("alert.registerEntryId links back to the source entry", async () => {
    const t = convexTest(schema, modules);
    const { orgId } = await seedOrg(t);

    const entryId = await insertRegisterEntry(t, orgId, {
      expiresAt: NOW - 1 * MS_PER_DAY,
      label: "Linked Expired Licence",
    });

    await t.mutation(api.currency.sweep, { orgId, nowMs: NOW });

    const alerts = await t.query(api.currency.list, { orgId });
    expect(alerts.length).toBe(1);
    expect(alerts[0].registerEntryId).toBe(entryId);
  });
});

// ---------------------------------------------------------------------------
// currency.sweep — idempotency (no duplicates on re-run)
// ---------------------------------------------------------------------------

describe("currency.sweep — idempotency", () => {
  test("second sweep on same data creates 0 new alerts (open alert already exists)", async () => {
    const t = convexTest(schema, modules);
    const { orgId } = await seedOrg(t);

    await insertRegisterEntry(t, orgId, {
      expiresAt: NOW - 3 * MS_PER_DAY,
      label: "Expired — idempotency test",
    });

    const first = await t.mutation(api.currency.sweep, { orgId, nowMs: NOW });
    expect(first.created).toBe(1);

    // Run sweep again with the same nowMs
    const second = await t.mutation(api.currency.sweep, { orgId, nowMs: NOW });
    expect(second.created).toBe(0);

    // Still only one alert in total
    const alerts = await t.query(api.currency.list, { orgId });
    expect(alerts.length).toBe(1);
  });

  test("third sweep still creates 0 duplicates for multiple entries", async () => {
    const t = convexTest(schema, modules);
    const { orgId } = await seedOrg(t);

    await insertRegisterEntry(t, orgId, {
      expiresAt: NOW - 2 * MS_PER_DAY,
      label: "Entry A",
    });
    await insertRegisterEntry(t, orgId, {
      expiresAt: NOW + 5 * MS_PER_DAY,
      label: "Entry B",
    });

    await t.mutation(api.currency.sweep, { orgId, nowMs: NOW });
    await t.mutation(api.currency.sweep, { orgId, nowMs: NOW });
    const third = await t.mutation(api.currency.sweep, { orgId, nowMs: NOW });

    expect(third.created).toBe(0);

    const alerts = await t.query(api.currency.list, { orgId });
    expect(alerts.length).toBe(2); // one expired + one expiring_soon
  });

  test("creating a new entry between sweeps produces only 1 new alert on the second sweep", async () => {
    const t = convexTest(schema, modules);
    const { orgId } = await seedOrg(t);

    await insertRegisterEntry(t, orgId, {
      expiresAt: NOW - 1 * MS_PER_DAY,
      label: "Old Expired",
    });

    const first = await t.mutation(api.currency.sweep, { orgId, nowMs: NOW });
    expect(first.created).toBe(1);

    // Add a brand-new expired entry
    await insertRegisterEntry(t, orgId, {
      expiresAt: NOW - 2 * MS_PER_DAY,
      label: "New Expired",
    });

    const second = await t.mutation(api.currency.sweep, { orgId, nowMs: NOW });
    expect(second.created).toBe(1); // only the newly added entry gets an alert

    const alerts = await t.query(api.currency.list, { orgId });
    expect(alerts.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// currency.sweep — overdue inspection alerts
// ---------------------------------------------------------------------------

describe("currency.sweep — overdue inspection alerts", () => {
  test("creates an 'overdue' alert for an in_progress inspection with dueAt in the past", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId, templateId, templateVersionId } = await seedOrg(t);

    await insertInspection(t, orgId, {
      status: "in_progress",
      dueAt: NOW - 1 * MS_PER_DAY, // due yesterday
      templateId,
      templateVersionId,
      userId,
    });

    const result = await t.mutation(api.currency.sweep, { orgId, nowMs: NOW });

    expect(result.created).toBeGreaterThanOrEqual(1);

    const alerts = await t.query(api.currency.list, { orgId });
    const overdue = alerts.filter((a: { kind: string }) => a.kind === "overdue");
    expect(overdue.length).toBe(1);
    expect(overdue[0].status).toBe("open");
    expect(["low", "medium", "high", "critical"]).toContain(overdue[0].severity);
  });

  test("does NOT create 'overdue' alert for a completed inspection with past dueAt", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId, templateId, templateVersionId } = await seedOrg(t);

    await insertInspection(t, orgId, {
      status: "completed",
      dueAt: NOW - 5 * MS_PER_DAY,
      templateId,
      templateVersionId,
      userId,
    });

    const result = await t.mutation(api.currency.sweep, { orgId, nowMs: NOW });

    const alerts = await t.query(api.currency.list, { orgId });
    const overdue = alerts.filter((a: { kind: string }) => a.kind === "overdue");
    expect(overdue.length).toBe(0);
  });

  test("does NOT create 'overdue' alert for an in_progress inspection with future dueAt", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId, templateId, templateVersionId } = await seedOrg(t);

    await insertInspection(t, orgId, {
      status: "in_progress",
      dueAt: NOW + 3 * MS_PER_DAY, // due in the future
      templateId,
      templateVersionId,
      userId,
    });

    const result = await t.mutation(api.currency.sweep, { orgId, nowMs: NOW });

    const alerts = await t.query(api.currency.list, { orgId });
    const overdue = alerts.filter((a: { kind: string }) => a.kind === "overdue");
    expect(overdue.length).toBe(0);
  });

  test("does NOT create 'overdue' alert for inspection with no dueAt set", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId, templateId, templateVersionId } = await seedOrg(t);

    // No dueAt — no overdue
    await insertInspection(t, orgId, {
      status: "in_progress",
      templateId,
      templateVersionId,
      userId,
    });

    const result = await t.mutation(api.currency.sweep, { orgId, nowMs: NOW });

    const alerts = await t.query(api.currency.list, { orgId });
    const overdue = alerts.filter((a: { kind: string }) => a.kind === "overdue");
    expect(overdue.length).toBe(0);
  });

  test("overdue inspection alert links back via inspectionId", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId, templateId, templateVersionId } = await seedOrg(t);

    const inspId = await insertInspection(t, orgId, {
      status: "in_progress",
      dueAt: NOW - 2 * MS_PER_DAY,
      templateId,
      templateVersionId,
      userId,
    });

    await t.mutation(api.currency.sweep, { orgId, nowMs: NOW });

    const alerts = await t.query(api.currency.list, { orgId });
    const overdue = alerts.filter((a: { kind: string }) => a.kind === "overdue");
    expect(overdue.length).toBe(1);
    expect(overdue[0].inspectionId).toBe(inspId);
  });

  test("overdue inspection sweep is idempotent", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId, templateId, templateVersionId } = await seedOrg(t);

    await insertInspection(t, orgId, {
      status: "in_progress",
      dueAt: NOW - 1 * MS_PER_DAY,
      templateId,
      templateVersionId,
      userId,
    });

    const first = await t.mutation(api.currency.sweep, { orgId, nowMs: NOW });
    const second = await t.mutation(api.currency.sweep, { orgId, nowMs: NOW });

    const alerts = await t.query(api.currency.list, { orgId });
    const overdue = alerts.filter((a: { kind: string }) => a.kind === "overdue");
    expect(overdue.length).toBe(1); // not 2
    // The second sweep should not have created the duplicate
    // (first.created may include the overdue, second.created for overdue should be 0)
    expect(second.created).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// currency.sweep — org isolation
// ---------------------------------------------------------------------------

describe("currency.sweep — org isolation", () => {
  test("sweep only creates alerts for the target org, not for another org's entries", async () => {
    const t = convexTest(schema, modules);

    // Org A with an expired entry
    const { orgId: orgA } = await seedOrg(t);
    await insertRegisterEntry(t, orgA, {
      expiresAt: NOW - 5 * MS_PER_DAY,
      label: "Org A Expired",
    });

    // Org B with its own expired entry
    const orgB = await t.run(async (ctx) =>
      ctx.db.insert("organizations", {
        name: "Org B",
        slug: `org-b-${Date.now()}`,
        plan: "free",
      }),
    );
    await insertRegisterEntry(t, orgB as unknown as string, {
      expiresAt: NOW - 3 * MS_PER_DAY,
      label: "Org B Expired",
    });

    // Sweep only org A
    await t.mutation(api.currency.sweep, { orgId: orgA, nowMs: NOW });

    // Org B should have no alerts
    const orgBAlerts = await t.query(api.currency.list, {
      orgId: orgB as unknown as string,
    });
    expect(orgBAlerts).toEqual([]);

    // Org A should have exactly one
    const orgAAlerts = await t.query(api.currency.list, { orgId: orgA });
    expect(orgAAlerts.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// currency.sweep — custom defaultLeadDays
// ---------------------------------------------------------------------------

describe("currency.sweep — custom defaultLeadDays", () => {
  test("uses defaultLeadDays parameter to determine expiring_soon window", async () => {
    const t = convexTest(schema, modules);
    const { orgId } = await seedOrg(t);

    // Entry expiring in 45 days — outside the default 30-day window but inside a 60-day window
    await insertRegisterEntry(t, orgId, {
      expiresAt: NOW + 45 * MS_PER_DAY,
      label: "Entry for custom lead test",
    });

    // With default 30-day lead: status = "current" → no alert
    const r1 = await t.mutation(api.currency.sweep, {
      orgId,
      nowMs: NOW,
      defaultLeadDays: 30,
    });
    expect(r1.created).toBe(0);

    // With 60-day lead: status = "expiring_soon" → alert created
    const r2 = await t.mutation(api.currency.sweep, {
      orgId,
      nowMs: NOW,
      defaultLeadDays: 60,
    });
    expect(r2.created).toBe(1);

    const alerts = await t.query(api.currency.list, { orgId });
    expect(alerts.length).toBe(1);
    expect(alerts[0].kind).toBe("expiring_soon");
  });
});

// ---------------------------------------------------------------------------
// currency.list — basic query
// ---------------------------------------------------------------------------

describe("currency.list", () => {
  test("returns empty array when no alerts exist", async () => {
    const t = convexTest(schema, modules);
    const { orgId } = await seedOrg(t);

    const alerts = await t.query(api.currency.list, { orgId });
    expect(Array.isArray(alerts)).toBe(true);
    expect(alerts).toEqual([]);
  });

  test("returned alerts have the expected shape", async () => {
    const t = convexTest(schema, modules);
    const { orgId } = await seedOrg(t);

    await insertRegisterEntry(t, orgId, {
      expiresAt: NOW - 1 * MS_PER_DAY,
      label: "Shape test entry",
    });

    await t.mutation(api.currency.sweep, { orgId, nowMs: NOW });

    const alerts = await t.query(api.currency.list, { orgId });
    expect(alerts.length).toBe(1);

    const a = alerts[0];
    // Required fields
    expect(typeof a._id).toBe("string");
    expect(a.orgId).toBe(orgId);
    expect(["expiring_soon", "expired", "overdue", "review_due"]).toContain(a.kind);
    expect(["low", "medium", "high", "critical"]).toContain(a.severity);
    expect(typeof a.message).toBe("string");
    expect(["open", "acknowledged", "resolved"]).toContain(a.status);
    expect(typeof a.createdAt).toBe("number");
  });

  test("does not return alerts from a different org", async () => {
    const t = convexTest(schema, modules);
    const { orgId: orgA } = await seedOrg(t);

    const orgB = await t.run(async (ctx) =>
      ctx.db.insert("organizations", {
        name: "Other Org",
        slug: `other-org-list-${Date.now()}`,
        plan: "free",
      }),
    );

    await insertRegisterEntry(t, orgA, {
      expiresAt: NOW - 1 * MS_PER_DAY,
      label: "Org A entry",
    });

    await t.mutation(api.currency.sweep, { orgId: orgA, nowMs: NOW });

    const orgBAlerts = await t.query(api.currency.list, {
      orgId: orgB as unknown as string,
    });
    expect(orgBAlerts).toEqual([]);
  });
});

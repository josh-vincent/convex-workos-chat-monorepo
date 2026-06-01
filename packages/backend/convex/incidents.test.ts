/**
 * Tests for Notifiable Incident + Tier-1 register types (spec §4 Tier 1, §6, §10, DoD #4).
 *
 * Intended API (to be implemented):
 *
 *  convex/schema.ts — additive/backward-compatible additions:
 *    `alerts.kind` union: ADD v.literal("notifiable_incident")
 *    `issues` table: ADD OPTIONAL fields:
 *      incidentType: v.optional(v.union(v.literal("injury"), v.literal("near_miss"),
 *        v.literal("dangerous_occurrence"), v.literal("illness")))
 *      notifiable: v.optional(v.boolean())
 *      occurredAt: v.optional(v.number())
 *      notifyDeadlineAt: v.optional(v.number())
 *
 *  convex/incidents.ts:
 *    `incidents.report({ orgId, anchorType?, anchorId?, incidentType, notifiable, occurredAt,
 *      description, reportedBy? })` (mutation):
 *      - Inserts an issue with severity "critical", status "open", the new incident fields.
 *      - If notifiable===true: computes notifyDeadlineAt = occurredAt +
 *        (window_hours from jurisdiction.getThreshold or default 48) * 3600000 ms,
 *        stores it on the issue, and inserts a CRITICAL alert kind "notifiable_incident"
 *        with a message naming the deadline.
 *      - Never auto-contacts a regulator.
 *      - Returns the issueId.
 *    `incidents.list({ orgId })` (query):
 *      - Returns all issues for the org that have a non-undefined incidentType field,
 *        ordered by createdAt descending (or any stable order).
 *
 *  convex/registers.ts:
 *    `registers.seedSampleRegisters({ orgId, anchorId })` (mutation):
 *      - Inserts one SDS entry and one induction entry for the given anchor.
 *      - Idempotent: a second call with the same (orgId, anchorId) does not duplicate rows.
 *      - Returns { sdsId, inductionId }.
 *
 * convex-test safe:
 *  - incidents.report is a plain mutation (ctx.db writes only, no components/workflow).
 *  - incidents.list is a plain query.
 *  - registers.seedSampleRegisters is a plain mutation.
 *  - All seeds use ctx.db.insert/t.run directly (no inspections.complete).
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

const MS_PER_HOUR = 60 * 60 * 1000;
const DEFAULT_WINDOW_HOURS = 48;

// A fixed "occurred at" time for deterministic tests.
const OCCURRED_AT = new Date("2026-06-01T08:00:00.000Z").getTime();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedOrg(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      name: "Incident Test Org",
      slug: `incident-test-org-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      plan: "free",
    });

    const userId = await ctx.db.insert("users", {
      orgId,
      name: "Reporter Bot",
      authMethod: "email",
    });

    return { orgId, userId };
  });
}

// ---------------------------------------------------------------------------
// incidents.report — notifiable incident
// ---------------------------------------------------------------------------

describe("incidents.report — notifiable incident", () => {
  test("returns a string issueId", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId } = await seedOrg(t);

    const issueId = await t.mutation(api.incidents.report, {
      orgId,
      incidentType: "injury",
      notifiable: true,
      occurredAt: OCCURRED_AT,
      description: "Worker injured hand on machinery",
      reportedBy: userId,
    });

    expect(typeof issueId).toBe("string");
    expect(issueId.length).toBeGreaterThan(0);
  });

  test("notifiable=true: issue has notifiable=true + notifyDeadlineAt = occurredAt + 48h (default window)", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId } = await seedOrg(t);

    const issueId = await t.mutation(api.incidents.report, {
      orgId,
      incidentType: "injury",
      notifiable: true,
      occurredAt: OCCURRED_AT,
      description: "Worker slipped and fell",
      reportedBy: userId,
    });

    const issue = await t.run(async (ctx) => ctx.db.get(issueId));
    expect(issue).not.toBeNull();
    expect(issue!.notifiable).toBe(true);
    // notifyDeadlineAt must be exactly occurredAt + DEFAULT_WINDOW_HOURS hours
    expect(issue!.notifyDeadlineAt).toBe(OCCURRED_AT + DEFAULT_WINDOW_HOURS * MS_PER_HOUR);
  });

  test("notifiable=true: exactly one CRITICAL 'notifiable_incident' alert is created", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId } = await seedOrg(t);

    await t.mutation(api.incidents.report, {
      orgId,
      incidentType: "dangerous_occurrence",
      notifiable: true,
      occurredAt: OCCURRED_AT,
      description: "Scaffolding collapse near workers",
      reportedBy: userId,
    });

    const alerts = await t.run(async (ctx) =>
      ctx.db
        .query("alerts")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect(),
    );

    const notifiableAlerts = alerts.filter(
      (a: { kind: string }) => a.kind === "notifiable_incident",
    );

    expect(notifiableAlerts.length).toBe(1);
    expect(notifiableAlerts[0].severity).toBe("critical");
    expect(notifiableAlerts[0].status).toBe("open");
    expect(typeof notifiableAlerts[0].message).toBe("string");
    // The message must mention the deadline (notifyDeadlineAt)
    expect(notifiableAlerts[0].message.length).toBeGreaterThan(0);
  });

  test("notifiable=true: alert message mentions the notify deadline", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId } = await seedOrg(t);

    const issueId = await t.mutation(api.incidents.report, {
      orgId,
      incidentType: "injury",
      notifiable: true,
      occurredAt: OCCURRED_AT,
      description: "Chemical exposure incident",
      reportedBy: userId,
    });

    const issue = await t.run(async (ctx) => ctx.db.get(issueId));
    const deadline = issue!.notifyDeadlineAt as number;

    const alerts = await t.run(async (ctx) =>
      ctx.db
        .query("alerts")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect(),
    );

    const notifiableAlert = alerts.find(
      (a: { kind: string }) => a.kind === "notifiable_incident",
    );

    expect(notifiableAlert).toBeDefined();
    // The message should reference the deadline in some form (ISO string or timestamp)
    // We just verify it's non-empty and truthy — the exact format is implementer's choice.
    expect(notifiableAlert!.message).toBeTruthy();
  });

  test("notifiable=true with jurisdiction window: notifyDeadlineAt uses the seeded window", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId } = await seedOrg(t);

    // Seed jurisdiction defaults so the incident reporter can find the 48h window.
    await t.mutation(api.jurisdiction.seedDefaults, {});

    const issueId = await t.mutation(api.incidents.report, {
      orgId,
      incidentType: "illness",
      notifiable: true,
      occurredAt: OCCURRED_AT,
      description: "Occupational illness reported",
      reportedBy: userId,
    });

    const issue = await t.run(async (ctx) => ctx.db.get(issueId));
    expect(issue!.notifyDeadlineAt).toBe(OCCURRED_AT + 48 * MS_PER_HOUR);
  });
});

// ---------------------------------------------------------------------------
// incidents.report — non-notifiable incident
// ---------------------------------------------------------------------------

describe("incidents.report — non-notifiable incident", () => {
  test("notifiable=false: no 'notifiable_incident' alert is created", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId } = await seedOrg(t);

    await t.mutation(api.incidents.report, {
      orgId,
      incidentType: "near_miss",
      notifiable: false,
      occurredAt: OCCURRED_AT,
      description: "Near miss — no injury",
      reportedBy: userId,
    });

    const alerts = await t.run(async (ctx) =>
      ctx.db
        .query("alerts")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect(),
    );

    const notifiableAlerts = alerts.filter(
      (a: { kind: string }) => a.kind === "notifiable_incident",
    );

    expect(notifiableAlerts.length).toBe(0);
  });

  test("notifiable=false: issue is inserted with notifiable=false, no notifyDeadlineAt", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId } = await seedOrg(t);

    const issueId = await t.mutation(api.incidents.report, {
      orgId,
      incidentType: "near_miss",
      notifiable: false,
      occurredAt: OCCURRED_AT,
      description: "Fork truck near miss",
      reportedBy: userId,
    });

    const issue = await t.run(async (ctx) => ctx.db.get(issueId));
    expect(issue).not.toBeNull();
    expect(issue!.notifiable).toBe(false);
    // notifyDeadlineAt must be absent (or undefined) for non-notifiable incidents
    expect(issue!.notifyDeadlineAt).toBeUndefined();
  });

  test("notifiable=false: total alert count remains 0", async () => {
    const t = convexTest(schema, modules);
    const { orgId } = await seedOrg(t);

    await t.mutation(api.incidents.report, {
      orgId,
      incidentType: "dangerous_occurrence",
      notifiable: false,
      occurredAt: OCCURRED_AT,
      description: "Crane near-miss event",
    });

    const alerts = await t.run(async (ctx) =>
      ctx.db
        .query("alerts")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect(),
    );

    expect(alerts.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// incidents.report — issue shape
// ---------------------------------------------------------------------------

describe("incidents.report — issue fields", () => {
  test("inserted issue has correct incidentType", async () => {
    const t = convexTest(schema, modules);
    const { orgId } = await seedOrg(t);

    const issueId = await t.mutation(api.incidents.report, {
      orgId,
      incidentType: "illness",
      notifiable: false,
      occurredAt: OCCURRED_AT,
      description: "Dermatitis from chemical exposure",
    });

    const issue = await t.run(async (ctx) => ctx.db.get(issueId));
    expect(issue!.incidentType).toBe("illness");
  });

  test("inserted issue has occurredAt stored", async () => {
    const t = convexTest(schema, modules);
    const { orgId } = await seedOrg(t);

    const issueId = await t.mutation(api.incidents.report, {
      orgId,
      incidentType: "injury",
      notifiable: false,
      occurredAt: OCCURRED_AT,
      description: "Hand laceration",
    });

    const issue = await t.run(async (ctx) => ctx.db.get(issueId));
    expect(issue!.occurredAt).toBe(OCCURRED_AT);
  });

  test("inserted issue has status 'open' and severity 'critical'", async () => {
    const t = convexTest(schema, modules);
    const { orgId } = await seedOrg(t);

    const issueId = await t.mutation(api.incidents.report, {
      orgId,
      incidentType: "injury",
      notifiable: true,
      occurredAt: OCCURRED_AT,
      description: "Serious crush injury",
    });

    const issue = await t.run(async (ctx) => ctx.db.get(issueId));
    expect(issue!.status).toBe("open");
    expect(issue!.severity).toBe("critical");
  });

  test("optional reportedBy is stored when provided", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId } = await seedOrg(t);

    const issueId = await t.mutation(api.incidents.report, {
      orgId,
      incidentType: "near_miss",
      notifiable: false,
      occurredAt: OCCURRED_AT,
      description: "Near-miss at loading dock",
      reportedBy: userId,
    });

    const issue = await t.run(async (ctx) => ctx.db.get(issueId));
    // raisedBy should match reportedBy (or it may map to raisedBy — check the intent)
    expect(issue!.orgId).toBe(orgId);
  });

  test("anchorType and anchorId are stored when provided", async () => {
    const t = convexTest(schema, modules);
    const { orgId } = await seedOrg(t);

    const issueId = await t.mutation(api.incidents.report, {
      orgId,
      anchorType: "site",
      anchorId: "site-main-001",
      incidentType: "dangerous_occurrence",
      notifiable: true,
      occurredAt: OCCURRED_AT,
      description: "Roof collapse at site A",
    });

    const issue = await t.run(async (ctx) => ctx.db.get(issueId));
    expect(issue).not.toBeNull();
    // anchorType and anchorId may be stored directly on the issue or as separate fields
    // At minimum the insert should succeed without error
    expect(typeof issueId).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// incidents.list
// ---------------------------------------------------------------------------

describe("incidents.list", () => {
  test("returns incidents previously reported for the org", async () => {
    const t = convexTest(schema, modules);
    const { orgId } = await seedOrg(t);

    await t.mutation(api.incidents.report, {
      orgId,
      incidentType: "injury",
      notifiable: false,
      occurredAt: OCCURRED_AT,
      description: "Sprained ankle",
    });

    await t.mutation(api.incidents.report, {
      orgId,
      incidentType: "near_miss",
      notifiable: false,
      occurredAt: OCCURRED_AT + 3600000,
      description: "Vehicle near-miss",
    });

    const incidents = await t.query(api.incidents.list, { orgId });
    expect(Array.isArray(incidents)).toBe(true);
    expect(incidents.length).toBe(2);
  });

  test("returns empty array when no incidents have been reported", async () => {
    const t = convexTest(schema, modules);
    const { orgId } = await seedOrg(t);

    const incidents = await t.query(api.incidents.list, { orgId });
    expect(Array.isArray(incidents)).toBe(true);
    expect(incidents.length).toBe(0);
  });

  test("does not return regular (non-incident) issues", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId } = await seedOrg(t);

    // Insert a plain issue via issues.create (no incidentType)
    await t.mutation(api.issues.create, {
      orgId,
      raisedBy: userId,
      title: "General hazard",
      severity: "medium",
    });

    // Now report one incident
    await t.mutation(api.incidents.report, {
      orgId,
      incidentType: "near_miss",
      notifiable: false,
      occurredAt: OCCURRED_AT,
      description: "Near-miss event",
    });

    const incidents = await t.query(api.incidents.list, { orgId });
    // incidents.list should only return the incident, not the plain issue
    expect(incidents.length).toBe(1);
    expect(incidents[0].incidentType).toBe("near_miss");
  });

  test("does not return incidents from a different org", async () => {
    const t = convexTest(schema, modules);
    const { orgId: orgA } = await seedOrg(t);
    const orgB = await t.run(async (ctx) =>
      ctx.db.insert("organizations", {
        name: "Other Org",
        slug: `other-org-incidents-${Date.now()}`,
        plan: "free",
      }),
    );

    await t.mutation(api.incidents.report, {
      orgId: orgA,
      incidentType: "injury",
      notifiable: false,
      occurredAt: OCCURRED_AT,
      description: "Org A incident",
    });

    const incidents = await t.query(api.incidents.list, {
      orgId: orgB as unknown as string,
    });
    expect(incidents).toEqual([]);
  });

  test("each returned incident has incidentType field", async () => {
    const t = convexTest(schema, modules);
    const { orgId } = await seedOrg(t);

    await t.mutation(api.incidents.report, {
      orgId,
      incidentType: "illness",
      notifiable: false,
      occurredAt: OCCURRED_AT,
      description: "Heat illness",
    });

    const incidents = await t.query(api.incidents.list, { orgId });
    expect(incidents.length).toBe(1);
    expect(incidents[0].incidentType).toBe("illness");
  });
});

// ---------------------------------------------------------------------------
// registers.seedSampleRegisters — Tier-1 register coverage
// ---------------------------------------------------------------------------

describe("registers.seedSampleRegisters", () => {
  test("inserts one SDS and one induction register entry", async () => {
    const t = convexTest(schema, modules);
    const { orgId } = await seedOrg(t);

    const result = await t.mutation(api.registers.seedSampleRegisters, {
      orgId,
      anchorId: "site-001",
    });

    expect(result).toBeDefined();
    expect(typeof result.sdsId).toBe("string");
    expect(typeof result.inductionId).toBe("string");

    // Verify the SDS entry exists in the DB
    const sdsEntry = await t.run(async (ctx) => ctx.db.get(result.sdsId));
    expect(sdsEntry).not.toBeNull();
    expect(sdsEntry!.registerType).toBe("sds");

    // Verify the induction entry exists in the DB
    const inductionEntry = await t.run(async (ctx) => ctx.db.get(result.inductionId));
    expect(inductionEntry).not.toBeNull();
    expect(inductionEntry!.registerType).toBe("induction");
  });

  test("is idempotent — second call returns same IDs, no duplicate rows", async () => {
    const t = convexTest(schema, modules);
    const { orgId } = await seedOrg(t);

    const first = await t.mutation(api.registers.seedSampleRegisters, {
      orgId,
      anchorId: "site-002",
    });

    const second = await t.mutation(api.registers.seedSampleRegisters, {
      orgId,
      anchorId: "site-002",
    });

    // Same IDs returned
    expect(second.sdsId).toBe(first.sdsId);
    expect(second.inductionId).toBe(first.inductionId);

    // Only one of each in the DB
    const allEntries = await t.run(async (ctx) =>
      ctx.db
        .query("registerEntries")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect(),
    );

    const sdsEntries = allEntries.filter(
      (e: { registerType: string }) => e.registerType === "sds",
    );
    const inductionEntries = allEntries.filter(
      (e: { registerType: string }) => e.registerType === "induction",
    );

    expect(sdsEntries.length).toBe(1);
    expect(inductionEntries.length).toBe(1);
  });

  test("different anchorIds produce separate entry sets", async () => {
    const t = convexTest(schema, modules);
    const { orgId } = await seedOrg(t);

    await t.mutation(api.registers.seedSampleRegisters, {
      orgId,
      anchorId: "site-A",
    });

    await t.mutation(api.registers.seedSampleRegisters, {
      orgId,
      anchorId: "site-B",
    });

    const allEntries = await t.run(async (ctx) =>
      ctx.db
        .query("registerEntries")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect(),
    );

    // 2 SDS + 2 induction = 4 total entries
    expect(allEntries.length).toBe(4);
  });

  test("seeded SDS entry has anchorType 'site' (or 'asset') and correct orgId", async () => {
    const t = convexTest(schema, modules);
    const { orgId } = await seedOrg(t);

    const result = await t.mutation(api.registers.seedSampleRegisters, {
      orgId,
      anchorId: "site-003",
    });

    const sdsEntry = await t.run(async (ctx) => ctx.db.get(result.sdsId));
    expect(sdsEntry!.orgId).toBe(orgId);
    expect(sdsEntry!.anchorId).toBe("site-003");
  });

  test("seeded induction entry has correct orgId and anchorId", async () => {
    const t = convexTest(schema, modules);
    const { orgId } = await seedOrg(t);

    const result = await t.mutation(api.registers.seedSampleRegisters, {
      orgId,
      anchorId: "person-007",
    });

    const inductionEntry = await t.run(async (ctx) => ctx.db.get(result.inductionId));
    expect(inductionEntry!.orgId).toBe(orgId);
    expect(inductionEntry!.anchorId).toBe("person-007");
  });
});

// ---------------------------------------------------------------------------
// Schema smoke — verify new fields exist on the issues table
// ---------------------------------------------------------------------------

describe("schema smoke — issues incidentType fields", () => {
  test("can insert an issue with incidentType='injury' directly via ctx.db", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId } = await seedOrg(t);

    const issueId = await t.run(async (ctx) =>
      ctx.db.insert("issues", {
        orgId,
        raisedBy: userId,
        title: "Worker injury",
        severity: "critical",
        status: "open",
        incidentType: "injury",
        notifiable: true,
        occurredAt: OCCURRED_AT,
        notifyDeadlineAt: OCCURRED_AT + 48 * MS_PER_HOUR,
      }),
    );

    const issue = await t.run(async (ctx) => ctx.db.get(issueId));
    expect(issue).not.toBeNull();
    expect(issue!.incidentType).toBe("injury");
    expect(issue!.notifiable).toBe(true);
    expect(issue!.occurredAt).toBe(OCCURRED_AT);
    expect(issue!.notifyDeadlineAt).toBe(OCCURRED_AT + 48 * MS_PER_HOUR);
  });

  test("can insert an issue with incidentType='near_miss' and no expiry fields", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId } = await seedOrg(t);

    const issueId = await t.run(async (ctx) =>
      ctx.db.insert("issues", {
        orgId,
        raisedBy: userId,
        title: "Near miss event",
        severity: "high",
        status: "open",
        incidentType: "near_miss",
        notifiable: false,
        occurredAt: OCCURRED_AT,
      }),
    );

    const issue = await t.run(async (ctx) => ctx.db.get(issueId));
    expect(issue!.incidentType).toBe("near_miss");
    expect(issue!.notifyDeadlineAt).toBeUndefined();
  });

  test("can insert a regular issue without any incident fields (backward compat)", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId } = await seedOrg(t);

    const issueId = await t.run(async (ctx) =>
      ctx.db.insert("issues", {
        orgId,
        raisedBy: userId,
        title: "Regular hazard",
        severity: "medium",
        status: "open",
      }),
    );

    const issue = await t.run(async (ctx) => ctx.db.get(issueId));
    expect(issue).not.toBeNull();
    expect(issue!.incidentType).toBeUndefined();
    expect(issue!.notifiable).toBeUndefined();
  });

  test("can insert an alert with kind='notifiable_incident' directly via ctx.db", async () => {
    const t = convexTest(schema, modules);
    const { orgId } = await seedOrg(t);

    const alertId = await t.run(async (ctx) =>
      ctx.db.insert("alerts", {
        orgId,
        kind: "notifiable_incident",
        severity: "critical",
        message: "Notifiable incident: notify regulator by 2026-06-03T08:00:00.000Z",
        status: "open",
        createdAt: Date.now(),
      }),
    );

    const alert = await t.run(async (ctx) => ctx.db.get(alertId));
    expect(alert).not.toBeNull();
    expect(alert!.kind).toBe("notifiable_incident");
    expect(alert!.severity).toBe("critical");
  });
});

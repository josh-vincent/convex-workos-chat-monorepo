/**
 * Tests for Compliance-pack assembly (spec §10, DoD #10).
 *
 * Intended API (to be implemented):
 *
 *  convex/compliance.ts — exported public API:
 *    `compliance.packData({ anchorType, anchorId })` (query) → {
 *      anchor: { anchorType, anchorId },
 *      inspections: Array<inspection row>,
 *      actions:     Array<action row>,
 *      registers:   Array<registerEntry row & { status: CurrencyStatus }>,
 *      mediaIds:    string[],   // de-duplicated, from inspection responses + documentRef
 *      counts: {
 *        inspections: number,
 *        actions:     number,
 *        registers:   number,
 *        mediaIds:    number,
 *      },
 *    }
 *    anchorType here is the INSPECTION anchor union (job|site|contract|person|asset).
 *    For registers, the anchorType values map:
 *      - "job"          → no registerEntries table supports "job" anchorType; return []
 *      - "site"         → look up registerEntries with anchorType "site"
 *      - "contract"     → no registerEntries table supports "contract"; return []
 *      - "person"       → look up registerEntries with anchorType "person"
 *      - "asset"        → look up registerEntries with anchorType "asset"
 *    (Implementer may also choose to do a direct anchorType match when they overlap.)
 *
 *  "use node" action (implement but do NOT unit-test here):
 *    `compliance.pack({ anchorType, anchorId })` in a "use node" file that calls
 *    packData via runQuery and returns a bundle/manifest.
 *
 * Test surface: insert a job + 2 inspections anchored to it (+ one anchored elsewhere)
 * + actions linked to those inspections + a registerEntry; assert packData returns
 * exactly the anchored inspections/actions/registers, register status is derived,
 * mediaIds are de-duplicated, and counts are correct.
 *
 * convex-test safe:
 *  - packData is a plain query — no component calls.
 *  - All "completed"/"submitted" inspections are inserted directly via ctx.db.insert
 *    (never via inspections.complete which calls workflow.start + scoreByOrg/scoreBySite).
 *  - No component calls anywhere.
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
// Helpers
// ---------------------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Use ctx.storage.store() inside t.run() — convex-test exposes a StorageWriter
 * so we can store a tiny Blob and get back a proper v.id("_storage").
 */
async function seedStorageId(t: ReturnType<typeof convexTest>): Promise<string> {
  return t.run(async (ctx) => {
    const blob = new Blob(["test"], { type: "image/png" });
    return (ctx as unknown as { storage: { store: (b: Blob) => Promise<string> } }).storage.store(blob);
  });
}

/** Seed the minimal prerequisite rows every test in this file needs. */
async function seedPrerequisites(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      name: "Compliance Pack Test Org",
      slug: "compliance-pack-test",
      plan: "free",
    });

    const userId = await ctx.db.insert("users", {
      orgId,
      name: "Inspector Compliance",
      authMethod: "email",
    });

    const templateId = await ctx.db.insert("templates", {
      orgId,
      key: "compliance.pack_test_template",
      name: "Compliance Pack Test Template",
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

/**
 * Insert a completed inspection directly via ctx.db (bypasses workflow/components).
 * Supports optional anchorType, anchorId, and responses with mediaIds.
 */
async function insertInspection(
  t: ReturnType<typeof convexTest>,
  p: Awaited<ReturnType<typeof seedPrerequisites>>,
  overrides: {
    anchorType?: "job" | "site" | "contract" | "person" | "asset";
    anchorId?: string;
    status?: "completed" | "submitted" | "in_progress";
    responses?: Array<{
      questionId: string;
      value?: unknown;
      note?: string;
      mediaIds?: string[];
      flagged?: boolean;
    }>;
  } = {},
) {
  return t.run(async (ctx) => {
    return ctx.db.insert("inspections", {
      orgId: p.orgId,
      templateId: p.templateId,
      templateVersionId: p.templateVersionId,
      version: 1,
      inspectorId: p.userId,
      status: overrides.status ?? "completed",
      startedAt: Date.now() - 60_000,
      completedAt: Date.now(),
      responses: (overrides.responses ?? []) as Array<{
        questionId: string;
        value?: unknown;
        note?: string;
        mediaIds?: Array<ReturnType<typeof p.orgId> extends infer _ ? string : never>;
        flagged?: boolean;
      }>,
      ...(overrides.anchorType !== undefined && { anchorType: overrides.anchorType }),
      ...(overrides.anchorId !== undefined && { anchorId: overrides.anchorId }),
    } as Parameters<typeof ctx.db.insert<"inspections">>[1]);
  });
}

// ---------------------------------------------------------------------------
// compliance.packData — basic shape
// ---------------------------------------------------------------------------

describe("compliance.packData — basic shape", () => {
  test("returns an object with anchor, inspections, actions, registers, mediaIds, counts", async () => {
    const t = convexTest(schema, modules);
    const p = await seedPrerequisites(t);

    const jobId = await t.mutation(api.jobs.create, {
      orgId: p.orgId,
      name: "Test Job",
    });

    const result = await t.query(api.compliance.packData, {
      anchorType: "job",
      anchorId: jobId,
    });

    // Top-level keys must exist
    expect(result).toHaveProperty("anchor");
    expect(result).toHaveProperty("inspections");
    expect(result).toHaveProperty("actions");
    expect(result).toHaveProperty("registers");
    expect(result).toHaveProperty("mediaIds");
    expect(result).toHaveProperty("counts");

    // anchor echoes the input
    expect(result.anchor.anchorType).toBe("job");
    expect(result.anchor.anchorId).toBe(jobId);

    // counts is an object with the four expected numeric keys
    expect(typeof result.counts.inspections).toBe("number");
    expect(typeof result.counts.actions).toBe("number");
    expect(typeof result.counts.registers).toBe("number");
    expect(typeof result.counts.mediaIds).toBe("number");
  });

  test("returns empty arrays and zero counts when anchor has no data", async () => {
    const t = convexTest(schema, modules);
    const p = await seedPrerequisites(t);

    const jobId = await t.mutation(api.jobs.create, {
      orgId: p.orgId,
      name: "Empty Job",
    });

    const result = await t.query(api.compliance.packData, {
      anchorType: "job",
      anchorId: jobId,
    });

    expect(result.inspections).toEqual([]);
    expect(result.actions).toEqual([]);
    expect(result.registers).toEqual([]);
    expect(result.mediaIds).toEqual([]);
    expect(result.counts.inspections).toBe(0);
    expect(result.counts.actions).toBe(0);
    expect(result.counts.registers).toBe(0);
    expect(result.counts.mediaIds).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// compliance.packData — inspections filtering
// ---------------------------------------------------------------------------

describe("compliance.packData — inspections", () => {
  test("includes inspections anchored to the job, excludes those anchored elsewhere", async () => {
    const t = convexTest(schema, modules);
    const p = await seedPrerequisites(t);

    const jobA = await t.mutation(api.jobs.create, {
      orgId: p.orgId,
      name: "Job A",
    });

    const jobB = await t.mutation(api.jobs.create, {
      orgId: p.orgId,
      name: "Job B",
    });

    // Two inspections anchored to jobA
    const inspA1 = await insertInspection(t, p, {
      anchorType: "job",
      anchorId: jobA,
    });
    const inspA2 = await insertInspection(t, p, {
      anchorType: "job",
      anchorId: jobA,
    });

    // One inspection anchored to jobB — should NOT appear in jobA's pack
    await insertInspection(t, p, {
      anchorType: "job",
      anchorId: jobB,
    });

    const result = await t.query(api.compliance.packData, {
      anchorType: "job",
      anchorId: jobA,
    });

    expect(result.inspections.length).toBe(2);
    const ids = result.inspections.map((i: { _id: string }) => i._id);
    expect(ids).toContain(inspA1);
    expect(ids).toContain(inspA2);
    expect(result.counts.inspections).toBe(2);
  });

  test("includes unanchored inspections only when they're explicitly linked (not by default)", async () => {
    const t = convexTest(schema, modules);
    const p = await seedPrerequisites(t);

    const jobId = await t.mutation(api.jobs.create, {
      orgId: p.orgId,
      name: "Isolated Job",
    });

    // Insert an inspection with NO anchor — should NOT appear in job's pack
    await insertInspection(t, p, {});

    const result = await t.query(api.compliance.packData, {
      anchorType: "job",
      anchorId: jobId,
    });

    expect(result.inspections).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// compliance.packData — actions filtering
// ---------------------------------------------------------------------------

describe("compliance.packData — actions", () => {
  test("includes actions linked to anchored inspections", async () => {
    const t = convexTest(schema, modules);
    const p = await seedPrerequisites(t);

    const jobId = await t.mutation(api.jobs.create, {
      orgId: p.orgId,
      name: "Job with Actions",
    });

    const inspId = await insertInspection(t, p, {
      anchorType: "job",
      anchorId: jobId,
    });

    // Insert an action linked to that inspection
    const actionId = await t.run(async (ctx) => {
      return ctx.db.insert("actions", {
        orgId: p.orgId,
        title: "Fix broken guardrail",
        priority: "high",
        status: "open",
        source: "inspection",
        inspectionId: inspId as Parameters<typeof ctx.db.insert<"actions">>[1] extends { inspectionId?: infer I } ? I : never,
      } as Parameters<typeof ctx.db.insert<"actions">>[1]);
    });

    const result = await t.query(api.compliance.packData, {
      anchorType: "job",
      anchorId: jobId,
    });

    expect(result.actions.length).toBeGreaterThanOrEqual(1);
    const actionIds = result.actions.map((a: { _id: string }) => a._id);
    expect(actionIds).toContain(actionId);
    expect(result.counts.actions).toBeGreaterThanOrEqual(1);
  });

  test("excludes actions linked to inspections from a different anchor", async () => {
    const t = convexTest(schema, modules);
    const p = await seedPrerequisites(t);

    const jobA = await t.mutation(api.jobs.create, { orgId: p.orgId, name: "Job A" });
    const jobB = await t.mutation(api.jobs.create, { orgId: p.orgId, name: "Job B" });

    // Inspection + action anchored to jobA
    const inspA = await insertInspection(t, p, { anchorType: "job", anchorId: jobA });
    await t.run(async (ctx) => {
      return ctx.db.insert("actions", {
        orgId: p.orgId,
        title: "Action for Job A",
        priority: "medium",
        status: "open",
        source: "inspection",
        inspectionId: inspA as Parameters<typeof ctx.db.insert<"actions">>[1] extends { inspectionId?: infer I } ? I : never,
      } as Parameters<typeof ctx.db.insert<"actions">>[1]);
    });

    // Inspection + action anchored to jobB
    const inspB = await insertInspection(t, p, { anchorType: "job", anchorId: jobB });
    await t.run(async (ctx) => {
      return ctx.db.insert("actions", {
        orgId: p.orgId,
        title: "Action for Job B",
        priority: "medium",
        status: "open",
        source: "inspection",
        inspectionId: inspB as Parameters<typeof ctx.db.insert<"actions">>[1] extends { inspectionId?: infer I } ? I : never,
      } as Parameters<typeof ctx.db.insert<"actions">>[1]);
    });

    // Pack for jobA should only have jobA's action
    const result = await t.query(api.compliance.packData, {
      anchorType: "job",
      anchorId: jobA,
    });

    const titles = result.actions.map((a: { title: string }) => a.title);
    expect(titles).toContain("Action for Job A");
    expect(titles).not.toContain("Action for Job B");
  });
});

// ---------------------------------------------------------------------------
// compliance.packData — register entries
// ---------------------------------------------------------------------------

describe("compliance.packData — registers with derived currency status", () => {
  test("registers anchored to a site are included when packData is called with anchorType=site", async () => {
    const t = convexTest(schema, modules);
    const p = await seedPrerequisites(t);

    const siteId = await t.run(async (ctx) => {
      return ctx.db.insert("sites", {
        orgId: p.orgId,
        name: "Test Site",
      });
    });

    // Insert a registerEntry anchored to this site
    const regId = await t.mutation(api.registers.upsert, {
      orgId: p.orgId,
      registerType: "licence",
      anchorType: "site",
      anchorId: siteId,
      label: "Site Licence",
      expiresAt: Date.now() + 90 * MS_PER_DAY,
    });

    const result = await t.query(api.compliance.packData, {
      anchorType: "site",
      anchorId: siteId,
    });

    expect(result.registers.length).toBe(1);
    expect(result.registers[0]._id).toBe(regId);
    expect(result.counts.registers).toBe(1);
  });

  test("each register entry in the result has a derived status field", async () => {
    const t = convexTest(schema, modules);
    const p = await seedPrerequisites(t);

    const siteId = await t.run(async (ctx) => {
      return ctx.db.insert("sites", {
        orgId: p.orgId,
        name: "Status Site",
      });
    });

    // Insert a register entry that will have status "expired"
    await t.mutation(api.registers.upsert, {
      orgId: p.orgId,
      registerType: "insurance",
      anchorType: "site",
      anchorId: siteId,
      label: "Expired Insurance",
      expiresAt: Date.now() - 10 * MS_PER_DAY,
    });

    const result = await t.query(api.compliance.packData, {
      anchorType: "site",
      anchorId: siteId,
    });

    expect(result.registers.length).toBe(1);
    const reg = result.registers[0];
    // status is derived, not stored
    expect(reg.status).toBeDefined();
    const validStatuses = ["current", "expiring_soon", "expired", "missing", "review_due"];
    expect(validStatuses).toContain(reg.status);
    // This particular entry is expired
    expect(reg.status).toBe("expired");
  });

  test("registers from a different anchor are excluded", async () => {
    const t = convexTest(schema, modules);
    const p = await seedPrerequisites(t);

    const siteA = await t.run(async (ctx) =>
      ctx.db.insert("sites", { orgId: p.orgId, name: "Site A" })
    );
    const siteB = await t.run(async (ctx) =>
      ctx.db.insert("sites", { orgId: p.orgId, name: "Site B" })
    );

    await t.mutation(api.registers.upsert, {
      orgId: p.orgId,
      registerType: "licence",
      anchorType: "site",
      anchorId: siteA,
      label: "Site A Licence",
      expiresAt: Date.now() + 365 * MS_PER_DAY,
    });

    await t.mutation(api.registers.upsert, {
      orgId: p.orgId,
      registerType: "licence",
      anchorType: "site",
      anchorId: siteB,
      label: "Site B Licence",
      expiresAt: Date.now() + 365 * MS_PER_DAY,
    });

    const result = await t.query(api.compliance.packData, {
      anchorType: "site",
      anchorId: siteA,
    });

    expect(result.registers.length).toBe(1);
    expect(result.registers[0].label).toBe("Site A Licence");
  });
});

// ---------------------------------------------------------------------------
// compliance.packData — mediaIds de-duplication
// ---------------------------------------------------------------------------

describe("compliance.packData — mediaIds", () => {
  test("collects media ids from inspection responses and de-duplicates them", async () => {
    const t = convexTest(schema, modules);
    const p = await seedPrerequisites(t);

    const jobId = await t.mutation(api.jobs.create, {
      orgId: p.orgId,
      name: "Job with Media",
    });

    // Create real media rows via ctx.storage.store()
    const storageId1 = await seedStorageId(t);
    const storageId2 = await seedStorageId(t);

    const mediaId1 = await t.run(async (ctx) => {
      return ctx.db.insert("media", {
        orgId: p.orgId,
        storageId: storageId1 as Parameters<typeof ctx.db.insert<"media">>[1] extends { storageId: infer S } ? S : never,
        kind: "photo",
      } as Parameters<typeof ctx.db.insert<"media">>[1]);
    });

    const mediaId2 = await t.run(async (ctx) => {
      return ctx.db.insert("media", {
        orgId: p.orgId,
        storageId: storageId2 as Parameters<typeof ctx.db.insert<"media">>[1] extends { storageId: infer S } ? S : never,
        kind: "photo",
      } as Parameters<typeof ctx.db.insert<"media">>[1]);
    });

    // Inspection 1: references mediaId1 and mediaId2
    await insertInspection(t, p, {
      anchorType: "job",
      anchorId: jobId,
      responses: [
        {
          questionId: "q1",
          value: "pass",
          mediaIds: [mediaId1, mediaId2],
        },
      ],
    });

    // Inspection 2: references mediaId1 again (duplicate) and mediaId2
    await insertInspection(t, p, {
      anchorType: "job",
      anchorId: jobId,
      responses: [
        {
          questionId: "q2",
          value: "fail",
          mediaIds: [mediaId1], // duplicate of mediaId1
        },
      ],
    });

    const result = await t.query(api.compliance.packData, {
      anchorType: "job",
      anchorId: jobId,
    });

    // Should be de-duplicated: mediaId1, mediaId2 (not 3 entries)
    expect(Array.isArray(result.mediaIds)).toBe(true);
    expect(result.mediaIds.length).toBe(2);
    expect(result.mediaIds).toContain(mediaId1);
    expect(result.mediaIds).toContain(mediaId2);
    expect(result.counts.mediaIds).toBe(2);
  });

  test("includes documentRef from register entries in mediaIds", async () => {
    const t = convexTest(schema, modules);
    const p = await seedPrerequisites(t);

    const siteId = await t.run(async (ctx) =>
      ctx.db.insert("sites", { orgId: p.orgId, name: "Doc Site" })
    );

    const storageIdDoc = await seedStorageId(t);
    const docMediaId = await t.run(async (ctx) => {
      return ctx.db.insert("media", {
        orgId: p.orgId,
        storageId: storageIdDoc as Parameters<typeof ctx.db.insert<"media">>[1] extends { storageId: infer S } ? S : never,
        kind: "doc",
      } as Parameters<typeof ctx.db.insert<"media">>[1]);
    });

    await t.mutation(api.registers.upsert, {
      orgId: p.orgId,
      registerType: "licence",
      anchorType: "site",
      anchorId: siteId,
      label: "Licence with Doc",
      expiresAt: Date.now() + 365 * MS_PER_DAY,
      documentRef: docMediaId,
    });

    const result = await t.query(api.compliance.packData, {
      anchorType: "site",
      anchorId: siteId,
    });

    expect(result.mediaIds).toContain(docMediaId);
    expect(result.counts.mediaIds).toBeGreaterThanOrEqual(1);
  });

  test("mediaIds are de-duplicated across inspection responses AND register documentRefs", async () => {
    const t = convexTest(schema, modules);
    const p = await seedPrerequisites(t);

    const siteId = await t.run(async (ctx) =>
      ctx.db.insert("sites", { orgId: p.orgId, name: "Dedup Site" })
    );

    const sharedStorageId = await seedStorageId(t);
    const sharedMediaId = await t.run(async (ctx) => {
      return ctx.db.insert("media", {
        orgId: p.orgId,
        storageId: sharedStorageId as Parameters<typeof ctx.db.insert<"media">>[1] extends { storageId: infer S } ? S : never,
        kind: "photo",
      } as Parameters<typeof ctx.db.insert<"media">>[1]);
    });

    // Same media referenced in both an inspection response AND a register documentRef
    await insertInspection(t, p, {
      anchorType: "site",
      anchorId: siteId,
      responses: [
        { questionId: "q1", mediaIds: [sharedMediaId] },
      ],
    });

    await t.mutation(api.registers.upsert, {
      orgId: p.orgId,
      registerType: "licence",
      anchorType: "site",
      anchorId: siteId,
      label: "Shared Doc Licence",
      expiresAt: Date.now() + 365 * MS_PER_DAY,
      documentRef: sharedMediaId,
    });

    const result = await t.query(api.compliance.packData, {
      anchorType: "site",
      anchorId: siteId,
    });

    // sharedMediaId must appear exactly once, not twice
    const occurrences = result.mediaIds.filter((id: string) => id === sharedMediaId).length;
    expect(occurrences).toBe(1);
    expect(result.counts.mediaIds).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// compliance.packData — counts correctness
// ---------------------------------------------------------------------------

describe("compliance.packData — counts", () => {
  test("counts match actual array lengths", async () => {
    const t = convexTest(schema, modules);
    const p = await seedPrerequisites(t);

    const jobId = await t.mutation(api.jobs.create, {
      orgId: p.orgId,
      name: "Count Verification Job",
    });

    const countStorageId = await seedStorageId(t);
    const mediaId = await t.run(async (ctx) => {
      return ctx.db.insert("media", {
        orgId: p.orgId,
        storageId: countStorageId as Parameters<typeof ctx.db.insert<"media">>[1] extends { storageId: infer S } ? S : never,
        kind: "photo",
      } as Parameters<typeof ctx.db.insert<"media">>[1]);
    });

    // 2 inspections
    const insp1 = await insertInspection(t, p, {
      anchorType: "job",
      anchorId: jobId,
      responses: [{ questionId: "q1", mediaIds: [mediaId] }],
    });
    const insp2 = await insertInspection(t, p, {
      anchorType: "job",
      anchorId: jobId,
    });

    // 1 action for insp1
    await t.run(async (ctx) => {
      return ctx.db.insert("actions", {
        orgId: p.orgId,
        title: "Count Test Action",
        priority: "low",
        status: "open",
        source: "inspection",
        inspectionId: insp1 as Parameters<typeof ctx.db.insert<"actions">>[1] extends { inspectionId?: infer I } ? I : never,
      } as Parameters<typeof ctx.db.insert<"actions">>[1]);
    });

    const result = await t.query(api.compliance.packData, {
      anchorType: "job",
      anchorId: jobId,
    });

    // Counts must equal the actual array lengths
    expect(result.counts.inspections).toBe(result.inspections.length);
    expect(result.counts.actions).toBe(result.actions.length);
    expect(result.counts.registers).toBe(result.registers.length);
    expect(result.counts.mediaIds).toBe(result.mediaIds.length);

    // Spot-check exact values
    expect(result.counts.inspections).toBe(2);
    expect(result.counts.actions).toBe(1);
    expect(result.counts.mediaIds).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// compliance.packData — complete integration scenario
// ---------------------------------------------------------------------------

describe("compliance.packData — full integration scenario", () => {
  test("assembles a complete manifest: 2 anchored inspections, 1 elsewhere, actions, register, media", async () => {
    const t = convexTest(schema, modules);
    const p = await seedPrerequisites(t);

    // The primary anchor job
    const jobId = await t.mutation(api.jobs.create, {
      orgId: p.orgId,
      name: "Integration Test Job",
    });

    // A different anchor to verify exclusion
    const otherJobId = await t.mutation(api.jobs.create, {
      orgId: p.orgId,
      name: "Other Job",
    });

    // Create media items (use real storage ids via ctx.storage.store)
    const sid1 = await seedStorageId(t);
    const sid2 = await seedStorageId(t);
    const media1 = await t.run(async (ctx) =>
      ctx.db.insert("media", {
        orgId: p.orgId,
        storageId: sid1 as Parameters<typeof ctx.db.insert<"media">>[1] extends { storageId: infer S } ? S : never,
        kind: "photo",
      } as Parameters<typeof ctx.db.insert<"media">>[1])
    );
    const media2 = await t.run(async (ctx) =>
      ctx.db.insert("media", {
        orgId: p.orgId,
        storageId: sid2 as Parameters<typeof ctx.db.insert<"media">>[1] extends { storageId: infer S } ? S : never,
        kind: "photo",
      } as Parameters<typeof ctx.db.insert<"media">>[1])
    );

    // Inspection 1 anchored to jobId — has media1
    const insp1 = await insertInspection(t, p, {
      anchorType: "job",
      anchorId: jobId,
      responses: [{ questionId: "q1", value: "pass", mediaIds: [media1] }],
    });

    // Inspection 2 anchored to jobId — has media2 and media1 (duplicate)
    const insp2 = await insertInspection(t, p, {
      anchorType: "job",
      anchorId: jobId,
      responses: [
        { questionId: "q2", value: "fail", mediaIds: [media2, media1] },
      ],
    });

    // Inspection anchored to the OTHER job — must NOT appear in our manifest
    await insertInspection(t, p, {
      anchorType: "job",
      anchorId: otherJobId,
    });

    // Actions for insp1
    const actionId1 = await t.run(async (ctx) =>
      ctx.db.insert("actions", {
        orgId: p.orgId,
        title: "Action on Insp 1",
        priority: "high",
        status: "open",
        source: "inspection",
        inspectionId: insp1 as Parameters<typeof ctx.db.insert<"actions">>[1] extends { inspectionId?: infer I } ? I : never,
      } as Parameters<typeof ctx.db.insert<"actions">>[1])
    );

    // Actions for insp2
    const actionId2 = await t.run(async (ctx) =>
      ctx.db.insert("actions", {
        orgId: p.orgId,
        title: "Action on Insp 2",
        priority: "medium",
        status: "in_progress",
        source: "inspection",
        inspectionId: insp2 as Parameters<typeof ctx.db.insert<"actions">>[1] extends { inspectionId?: infer I } ? I : never,
      } as Parameters<typeof ctx.db.insert<"actions">>[1])
    );

    // Action for the OTHER inspection — must NOT appear
    const otherInsp = await insertInspection(t, p, {
      anchorType: "job",
      anchorId: otherJobId,
    });
    await t.run(async (ctx) =>
      ctx.db.insert("actions", {
        orgId: p.orgId,
        title: "Other Job Action",
        priority: "low",
        status: "open",
        source: "inspection",
        inspectionId: otherInsp as Parameters<typeof ctx.db.insert<"actions">>[1] extends { inspectionId?: infer I } ? I : never,
      } as Parameters<typeof ctx.db.insert<"actions">>[1])
    );

    // Fetch the pack
    const result = await t.query(api.compliance.packData, {
      anchorType: "job",
      anchorId: jobId,
    });

    // ── Anchor ──────────────────────────────────────────────────────────────
    expect(result.anchor.anchorType).toBe("job");
    expect(result.anchor.anchorId).toBe(jobId);

    // ── Inspections ─────────────────────────────────────────────────────────
    expect(result.counts.inspections).toBe(2);
    const inspIds = result.inspections.map((i: { _id: string }) => i._id);
    expect(inspIds).toContain(insp1);
    expect(inspIds).toContain(insp2);

    // ── Actions ─────────────────────────────────────────────────────────────
    expect(result.counts.actions).toBe(2);
    const actionIds = result.actions.map((a: { _id: string }) => a._id);
    expect(actionIds).toContain(actionId1);
    expect(actionIds).toContain(actionId2);

    // ── mediaIds — de-duplicated ─────────────────────────────────────────────
    // media1 appears in both insp1 and insp2 — should be deduplicated to 1 occurrence
    expect(result.counts.mediaIds).toBe(2); // media1 + media2 (de-duped)
    expect(result.mediaIds).toContain(media1);
    expect(result.mediaIds).toContain(media2);
    const media1Count = result.mediaIds.filter((id: string) => id === media1).length;
    expect(media1Count).toBe(1);
  });
});

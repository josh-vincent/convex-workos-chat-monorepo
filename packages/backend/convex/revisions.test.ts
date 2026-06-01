/**
 * Tests for append-only completed inspection records (spec §5.2, §10, DoD #2).
 *
 * Intended API (to be implemented):
 *
 * 1. convex/schema.ts — inspections table:
 *    - Add optional `supersededById` (v.optional(v.id("inspections")))
 *
 * 2. convex/inspections.ts — `inspections.saveResponses`:
 *    - Guard: if inspection.status === "completed" || "submitted" →
 *      throw new Error("Inspection is locked; create a revision instead.")
 *    - Allow when status === "in_progress" or "scheduled"
 *
 * 3. convex/inspections.ts — `inspections.setAnswer`:
 *    - Same guard as saveResponses.
 *
 * 4. convex/inspections.ts — `inspections.revise({ inspectionId })`:
 *    - Only allowed on a completed or submitted inspection; throws on in_progress.
 *    - Inserts a NEW inspection row:
 *        { ...same templateId/templateVersionId/version/orgId/anchorType/anchorId,
 *          status: "in_progress", responses: <copied from old>, startedAt: Date.now() }
 *    - Patches the OLD row: supersededById = newId
 *    - Returns the new inspection id.
 *    - Does NOT call complete()/components (workflow.start etc.)
 *
 * convex-test safe:
 *  - All "completed" / "submitted" inspections are inserted directly via t.run / ctx.db.insert
 *    (never via inspections.complete which calls workflow.start + scoreByOrg/scoreBySite).
 *  - No component calls anywhere.
 */
import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

// Same glob exclusions as smoke.test.ts — keep components/workflows/reports out.
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

/** Seed the minimal prerequisite rows shared by every test in this file. */
async function seedPrerequisites(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      name: "Revision Test Org",
      slug: "revision-test-org",
      plan: "free",
    });

    const userId = await ctx.db.insert("users", {
      orgId,
      name: "Inspector Rev",
      authMethod: "email",
    });

    const templateId = await ctx.db.insert("templates", {
      orgId,
      key: "revision.test_template",
      name: "Revision Test Template",
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
 * This is the convex-test-safe way to get a locked inspection into the DB.
 */
async function insertCompletedInspection(
  t: ReturnType<typeof convexTest>,
  p: Awaited<ReturnType<typeof seedPrerequisites>>,
  status: "completed" | "submitted" = "completed",
) {
  return t.run(async (ctx) => {
    return ctx.db.insert("inspections", {
      orgId: p.orgId,
      templateId: p.templateId,
      templateVersionId: p.templateVersionId,
      version: 1,
      inspectorId: p.userId,
      status,
      startedAt: Date.now() - 60_000,
      completedAt: Date.now(),
      responses: [{ questionId: "q1", value: "pass" }],
    });
  });
}

/** Insert an in_progress inspection directly. */
async function insertInProgressInspection(
  t: ReturnType<typeof convexTest>,
  p: Awaited<ReturnType<typeof seedPrerequisites>>,
) {
  return t.run(async (ctx) => {
    return ctx.db.insert("inspections", {
      orgId: p.orgId,
      templateId: p.templateId,
      templateVersionId: p.templateVersionId,
      version: 1,
      inspectorId: p.userId,
      status: "in_progress",
      startedAt: Date.now(),
      responses: [],
    });
  });
}

// ---------------------------------------------------------------------------
// saveResponses lock guard
// ---------------------------------------------------------------------------

describe("inspections.saveResponses — lock guard", () => {
  test("throws on a completed inspection", async () => {
    const t = convexTest(schema, modules);
    const prereqs = await seedPrerequisites(t);
    const inspectionId = await insertCompletedInspection(t, prereqs, "completed");

    await expect(
      t.mutation(api.inspections.saveResponses, {
        inspectionId,
        responses: [{ questionId: "q1", value: "fail" }],
      }),
    ).rejects.toThrow("Inspection is locked; create a revision instead.");
  });

  test("throws on a submitted inspection", async () => {
    const t = convexTest(schema, modules);
    const prereqs = await seedPrerequisites(t);
    const inspectionId = await insertCompletedInspection(t, prereqs, "submitted");

    await expect(
      t.mutation(api.inspections.saveResponses, {
        inspectionId,
        responses: [{ questionId: "q1", value: "fail" }],
      }),
    ).rejects.toThrow("Inspection is locked; create a revision instead.");
  });

  test("succeeds on an in_progress inspection", async () => {
    const t = convexTest(schema, modules);
    const prereqs = await seedPrerequisites(t);
    const inspectionId = await insertInProgressInspection(t, prereqs);

    // Must NOT throw.
    await expect(
      t.mutation(api.inspections.saveResponses, {
        inspectionId,
        responses: [{ questionId: "q1", value: "pass" }],
      }),
    ).resolves.not.toThrow();

    // Verify the responses were actually saved.
    const row = await t.run(async (ctx) => ctx.db.get(inspectionId));
    expect(row?.responses).toHaveLength(1);
    expect(row?.responses[0].questionId).toBe("q1");
  });
});

// ---------------------------------------------------------------------------
// setAnswer lock guard
// ---------------------------------------------------------------------------

describe("inspections.setAnswer — lock guard", () => {
  test("throws on a completed inspection", async () => {
    const t = convexTest(schema, modules);
    const prereqs = await seedPrerequisites(t);
    const inspectionId = await insertCompletedInspection(t, prereqs, "completed");

    await expect(
      t.mutation(api.inspections.setAnswer, {
        inspectionId,
        questionId: "q1",
        value: "fail",
      }),
    ).rejects.toThrow("Inspection is locked; create a revision instead.");
  });

  test("throws on a submitted inspection", async () => {
    const t = convexTest(schema, modules);
    const prereqs = await seedPrerequisites(t);
    const inspectionId = await insertCompletedInspection(t, prereqs, "submitted");

    await expect(
      t.mutation(api.inspections.setAnswer, {
        inspectionId,
        questionId: "q1",
        value: "fail",
      }),
    ).rejects.toThrow("Inspection is locked; create a revision instead.");
  });

  test("succeeds on an in_progress inspection", async () => {
    const t = convexTest(schema, modules);
    const prereqs = await seedPrerequisites(t);
    const inspectionId = await insertInProgressInspection(t, prereqs);

    // Must NOT throw.
    await expect(
      t.mutation(api.inspections.setAnswer, {
        inspectionId,
        questionId: "q42",
        value: "yes",
        note: "All clear",
      }),
    ).resolves.not.toThrow();

    // Verify the answer was merged into responses.
    const row = await t.run(async (ctx) => ctx.db.get(inspectionId));
    const answer = row?.responses.find((r: { questionId: string }) => r.questionId === "q42");
    expect(answer).toBeDefined();
    expect(answer!.value).toBe("yes");
  });
});

// ---------------------------------------------------------------------------
// inspections.revise
// ---------------------------------------------------------------------------

describe("inspections.revise", () => {
  test("creates a new in_progress inspection copying responses from the completed one", async () => {
    const t = convexTest(schema, modules);
    const prereqs = await seedPrerequisites(t);
    const oldId = await insertCompletedInspection(t, prereqs, "completed");

    const newId = await t.mutation(api.inspections.revise, { inspectionId: oldId });

    expect(typeof newId).toBe("string");
    expect(newId).not.toBe(oldId);

    const newRow = await t.run(async (ctx) => ctx.db.get(newId));
    expect(newRow).not.toBeNull();
    expect(newRow!.status).toBe("in_progress");
    // Copied from old inspection.
    expect(newRow!.templateId).toBe(prereqs.templateId);
    expect(newRow!.templateVersionId).toBe(prereqs.templateVersionId);
    expect(newRow!.orgId).toBe(prereqs.orgId);
    // Responses copied from old inspection (original had one response "q1":"pass").
    expect(newRow!.responses).toHaveLength(1);
    expect(newRow!.responses[0].questionId).toBe("q1");
    expect(newRow!.responses[0].value).toBe("pass");
  });

  test("patches the old inspection's supersededById to the new id", async () => {
    const t = convexTest(schema, modules);
    const prereqs = await seedPrerequisites(t);
    const oldId = await insertCompletedInspection(t, prereqs, "completed");

    const newId = await t.mutation(api.inspections.revise, { inspectionId: oldId });

    const oldRow = await t.run(async (ctx) => ctx.db.get(oldId));
    expect(oldRow).not.toBeNull();
    // supersededById must point at the newly created revision.
    expect((oldRow as Record<string, unknown>).supersededById).toBe(newId);
  });

  test("works on a submitted inspection as well as a completed one", async () => {
    const t = convexTest(schema, modules);
    const prereqs = await seedPrerequisites(t);
    const oldId = await insertCompletedInspection(t, prereqs, "submitted");

    const newId = await t.mutation(api.inspections.revise, { inspectionId: oldId });

    expect(typeof newId).toBe("string");

    const newRow = await t.run(async (ctx) => ctx.db.get(newId));
    expect(newRow!.status).toBe("in_progress");

    const oldRow = await t.run(async (ctx) => ctx.db.get(oldId));
    expect((oldRow as Record<string, unknown>).supersededById).toBe(newId);
  });

  test("throws when called on an in_progress inspection", async () => {
    const t = convexTest(schema, modules);
    const prereqs = await seedPrerequisites(t);
    const inspectionId = await insertInProgressInspection(t, prereqs);

    await expect(
      t.mutation(api.inspections.revise, { inspectionId }),
    ).rejects.toThrow();
  });

  test("new revision does not have supersededById set on itself", async () => {
    const t = convexTest(schema, modules);
    const prereqs = await seedPrerequisites(t);
    const oldId = await insertCompletedInspection(t, prereqs, "completed");

    const newId = await t.mutation(api.inspections.revise, { inspectionId: oldId });

    const newRow = await t.run(async (ctx) => ctx.db.get(newId));
    // The brand-new revision should not itself be superseded.
    expect((newRow as Record<string, unknown>).supersededById).toBeUndefined();
  });

  test("anchor fields are preserved on the revision", async () => {
    const t = convexTest(schema, modules);
    const prereqs = await seedPrerequisites(t);

    // Insert a completed inspection with anchor fields.
    const oldId = await t.run(async (ctx) => {
      return ctx.db.insert("inspections", {
        orgId: prereqs.orgId,
        templateId: prereqs.templateId,
        templateVersionId: prereqs.templateVersionId,
        version: 1,
        inspectorId: prereqs.userId,
        status: "completed",
        startedAt: Date.now() - 60_000,
        completedAt: Date.now(),
        responses: [],
        anchorType: "job",
        anchorId: "job-anchor-abc",
      });
    });

    const newId = await t.mutation(api.inspections.revise, { inspectionId: oldId });

    const newRow = await t.run(async (ctx) => ctx.db.get(newId));
    expect(newRow!.anchorType).toBe("job");
    expect(newRow!.anchorId).toBe("job-anchor-abc");
  });

  test("schema: supersededById field is accepted on direct db.insert (field exists in schema)", async () => {
    const t = convexTest(schema, modules);
    const prereqs = await seedPrerequisites(t);

    // Insert a completed inspection, then a second one that will be the superseder.
    const firstId = await insertCompletedInspection(t, prereqs, "completed");
    const secondId = await insertInProgressInspection(t, prereqs);

    // Directly patch supersededById — this validates the schema has the field.
    await expect(
      t.run(async (ctx) => {
        await ctx.db.patch(firstId, { supersededById: secondId } as Record<string, unknown>);
      }),
    ).resolves.not.toThrow();

    const row = await t.run(async (ctx) => ctx.db.get(firstId));
    expect((row as Record<string, unknown>).supersededById).toBe(secondId);
  });
});

/**
 * Tests for the anchor graph feature (spec §2, §5.2, §8, DoD #8).
 *
 * Intended API (to be implemented):
 *  - convex/jobs.ts: `jobs.create({ orgId, name, siteId?, hrcw? })` → id
 *  - convex/jobs.ts: `jobs.get({ jobId })` → job row | null
 *  - convex/schema.ts: `jobs` table (orgId, name, siteId?, status, hrcw?, startedReady?)
 *  - convex/schema.ts: `contracts` table (orgId, name, status?)
 *  - convex/schema.ts: `subcontractors` table (orgId, name, status?)
 *  - convex/schema.ts: `inspections` gains optional `anchorType` (union "job"|"site"|"contract"|"person"|"asset")
 *                      and optional `anchorId` (string), plus `by_anchor` index on ["anchorType","anchorId"]
 *  - convex/inspections.ts: `inspections.start` accepts optional `{ anchorType, anchorId }` and stores them
 *  - convex/records.ts (or inspections.ts): `records.byAnchor({ anchorType, anchorId })` → inspection[]
 *
 * convex-test safe: all tests use pure ctx.db CRUD — no component calls, no workflow.start,
 * no scoreByOrg/scoreBySite. Tests avoid calling inspections.complete (see CLAUDE.md constraints).
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
// Helpers: seed the minimal prerequisite rows every test needs.
// ---------------------------------------------------------------------------

async function seedPrerequisites(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      name: "Anchor Test Org",
      slug: "anchor-test-org",
      plan: "free",
    });

    const userId = await ctx.db.insert("users", {
      orgId,
      name: "Inspector A",
      authMethod: "email",
    });

    // A published template with one version (required by inspections.start).
    const templateId = await ctx.db.insert("templates", {
      orgId,
      key: "anchor.test_template",
      name: "Anchor Test Template",
      category: "safety",
      industry: "construction",
      currentVersion: 1,
      status: "published",
    });

    await ctx.db.insert("templateVersions", {
      templateId,
      version: 1,
      sections: [],
      scoringEnabled: false,
    });

    return { orgId, userId, templateId };
  });
}

// ---------------------------------------------------------------------------
// jobs.create / jobs.get
// ---------------------------------------------------------------------------

describe("jobs mutations", () => {
  test("jobs.create returns an id and jobs.get retrieves the row", async () => {
    const t = convexTest(schema, modules);
    const { orgId } = await seedPrerequisites(t);

    const jobId = await t.mutation(api.jobs.create, {
      orgId,
      name: "Road Reseal — Block A",
    });

    expect(typeof jobId).toBe("string");
    expect(jobId.length).toBeGreaterThan(0);

    const job = await t.query(api.jobs.get, { jobId });

    expect(job).not.toBeNull();
    expect(job!.name).toBe("Road Reseal — Block A");
    expect(job!.orgId).toBe(orgId);
    // Default status for a new job should be "draft"
    expect(job!.status).toBe("draft");
  });

  test("jobs.create stores optional hrcw flag", async () => {
    const t = convexTest(schema, modules);
    const { orgId } = await seedPrerequisites(t);

    const jobId = await t.mutation(api.jobs.create, {
      orgId,
      name: "High-Risk Construction Job",
      hrcw: true,
    });

    const job = await t.query(api.jobs.get, { jobId });
    expect(job).not.toBeNull();
    expect(job!.hrcw).toBe(true);
  });

  test("jobs.get returns null for an unknown id", async () => {
    const t = convexTest(schema, modules);
    const { orgId } = await seedPrerequisites(t);

    // Insert a job just so we have a valid id shape, then use a different org's id.
    // We actually just need a valid-format id that doesn't exist in the jobs table.
    // Use a freshly created and then non-existent id by querying an org that has no jobs.
    const job = await t.query(api.jobs.get, {
      // Pass orgId as jobId — it is a valid Convex id string but references the wrong table,
      // so .get("jobs", orgId) should return null (Convex returns null for cross-table mismatches).
      jobId: orgId as unknown as string,
    });

    // Either null or throws — both are acceptable "not found" signals.
    // We accept null here; implementer may also throw.
    expect(job).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// inspections.start with anchorType / anchorId
// ---------------------------------------------------------------------------

describe("inspections.start anchor fields", () => {
  test("start stores anchorType and anchorId when provided", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId, templateId } = await seedPrerequisites(t);

    // Create a job to anchor to.
    const jobId = await t.mutation(api.jobs.create, {
      orgId,
      name: "Anchor Job",
    });

    const inspectionId = await t.mutation(api.inspections.start, {
      orgId,
      templateId,
      inspectorId: userId,
      anchorType: "job",
      anchorId: jobId,
    });

    const row = await t.run(async (ctx) => ctx.db.get(inspectionId));

    expect(row).not.toBeNull();
    expect(row!.anchorType).toBe("job");
    expect(row!.anchorId).toBe(jobId);
  });

  test("start without anchor fields leaves anchorType/anchorId undefined", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId, templateId } = await seedPrerequisites(t);

    const inspectionId = await t.mutation(api.inspections.start, {
      orgId,
      templateId,
      inspectorId: userId,
    });

    const row = await t.run(async (ctx) => ctx.db.get(inspectionId));

    expect(row).not.toBeNull();
    // Fields should be absent / undefined — backward-compatible.
    expect(row!.anchorType).toBeUndefined();
    expect(row!.anchorId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// records.byAnchor
// ---------------------------------------------------------------------------

describe("records.byAnchor", () => {
  test("returns the inspection anchored to the given job", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId, templateId } = await seedPrerequisites(t);

    const jobId = await t.mutation(api.jobs.create, {
      orgId,
      name: "Target Job",
    });

    const inspectionId = await t.mutation(api.inspections.start, {
      orgId,
      templateId,
      inspectorId: userId,
      anchorType: "job",
      anchorId: jobId,
    });

    const results = await t.query(api.records.byAnchor, {
      anchorType: "job",
      anchorId: jobId,
    });

    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(1);
    expect(results[0]._id).toBe(inspectionId);
  });

  test("excludes inspections anchored to a different job", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId, templateId } = await seedPrerequisites(t);

    const jobA = await t.mutation(api.jobs.create, { orgId, name: "Job A" });
    const jobB = await t.mutation(api.jobs.create, { orgId, name: "Job B" });

    // Anchor one inspection to jobA, one to jobB.
    await t.mutation(api.inspections.start, {
      orgId,
      templateId,
      inspectorId: userId,
      anchorType: "job",
      anchorId: jobA,
    });

    const jobBInspectionId = await t.mutation(api.inspections.start, {
      orgId,
      templateId,
      inspectorId: userId,
      anchorType: "job",
      anchorId: jobB,
    });

    const results = await t.query(api.records.byAnchor, {
      anchorType: "job",
      anchorId: jobB,
    });

    expect(results.length).toBe(1);
    expect(results[0]._id).toBe(jobBInspectionId);
  });

  test("returns multiple inspections when several share the same anchor", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId, templateId } = await seedPrerequisites(t);

    const jobId = await t.mutation(api.jobs.create, { orgId, name: "Multi-Insp Job" });

    const id1 = await t.mutation(api.inspections.start, {
      orgId,
      templateId,
      inspectorId: userId,
      anchorType: "job",
      anchorId: jobId,
    });

    const id2 = await t.mutation(api.inspections.start, {
      orgId,
      templateId,
      inspectorId: userId,
      anchorType: "job",
      anchorId: jobId,
    });

    const results = await t.query(api.records.byAnchor, {
      anchorType: "job",
      anchorId: jobId,
    });

    expect(results.length).toBe(2);
    const ids = results.map((r: { _id: string }) => r._id);
    expect(ids).toContain(id1);
    expect(ids).toContain(id2);
  });

  test("returns empty array when no inspection matches the anchor", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId, templateId } = await seedPrerequisites(t);

    const jobId = await t.mutation(api.jobs.create, { orgId, name: "Lonely Job" });

    // Start an inspection NOT anchored to this job.
    await t.mutation(api.inspections.start, {
      orgId,
      templateId,
      inspectorId: userId,
    });

    const results = await t.query(api.records.byAnchor, {
      anchorType: "job",
      anchorId: jobId,
    });

    expect(results).toEqual([]);
  });

  test("anchorType discriminates: a 'site' anchor does not match a 'job' anchor with the same id string", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId, templateId } = await seedPrerequisites(t);

    const jobId = await t.mutation(api.jobs.create, { orgId, name: "Discriminate Job" });

    // Anchor inspection as "job".
    await t.mutation(api.inspections.start, {
      orgId,
      templateId,
      inspectorId: userId,
      anchorType: "job",
      anchorId: jobId,
    });

    // Query with anchorType "site" using the same id — should return nothing.
    const results = await t.query(api.records.byAnchor, {
      anchorType: "site",
      anchorId: jobId,
    });

    expect(results).toEqual([]);
  });
});

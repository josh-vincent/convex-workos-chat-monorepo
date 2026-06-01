/**
 * Tests for Workflow gates — enforce the right doc at the right moment
 * (spec §8, §13, DoD #6).
 *
 * Intended API (to be implemented):
 *
 * 1. convex/gates.ts — query:
 *    `gates.jobReadiness({ jobId, requiredEntryIds? })`
 *      → { ok: boolean; blockers: string[] }
 *
 *    Rules:
 *    (a) SWMS gate: if job.hrcw === true, at least one inspection must exist that is
 *        anchored to the job (anchorType "job", anchorId = jobId), whose template
 *        key OR category (lowercased) includes "swms", with status in
 *        (submitted | completed | closed | actions_open) AND signOffs.length >= 1.
 *        Else adds blocker: "Signed SWMS required".
 *
 *    (b) Licence gate: for each Id in requiredEntryIds (if provided), fetch the
 *        registerEntry and compute currencyStatus() via lib/currency.ts. Any entry
 *        whose status === "expired" adds blocker: "Expired licence: <entry.label>".
 *        If requiredEntryIds is absent or empty, skip licence checks entirely.
 *
 * 2. convex/jobs.ts (or convex/gates.ts) — mutation:
 *    `jobs.markReady({ jobId })`
 *      - Calls jobReadiness internally.
 *      - Reads org jurisdictionConfig key "swms_gate_block" (default true).
 *        * If true (hard block) and !ok → throws ConvexError / Error with the
 *          blocker list as context / message.
 *        * If false (soft gate) — sets job.startedReady = true even when blockers
 *          exist (and still returns { ok, blockers }).
 *      - On clear (no blockers): sets job.startedReady = true and returns
 *        { ok: true, blockers: [] }.
 *
 * Schema notes (all optional / additive — do NOT edit schema in this file):
 *   - jobs.startedReady: v.optional(v.boolean())  — already in schema
 *   - inspections already has anchorType/anchorId, signOffs, status
 *   - templates already has key and category fields
 *   - registerEntries already has expiresAt, leadTimeDays, label
 *   - jurisdictionConfigs already holds (jurisdiction, key, value)
 *
 * convex-test constraints:
 *  - Insert "completed"/"submitted" inspections directly via t.run / ctx.db.insert.
 *  - Do NOT call inspections.complete (invokes workflow.start → component).
 *  - No component calls anywhere.
 *  - Pure logic helpers go in convex/lib/*.ts; query/mutation in convex/gates.ts or jobs.ts.
 */
import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

// Same glob exclusions used throughout the test suite.
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

async function seedOrg(
  t: ReturnType<typeof convexTest>,
  overrides: { jurisdiction?: "vic_ohs" | "whs_harmonised" | "generic" } = {},
) {
  return t.run(async (ctx) => {
    return ctx.db.insert("organizations", {
      name: "Gates Test Org",
      slug: `gates-test-org-${Math.random().toString(36).slice(2)}`,
      plan: "free",
      ...overrides,
    });
  });
}

async function seedUser(t: ReturnType<typeof convexTest>, orgId: string) {
  return t.run(async (ctx) => {
    return ctx.db.insert("users", {
      orgId: orgId as Parameters<typeof ctx.db.insert<"users">>[1]["orgId"],
      name: "Gates Inspector",
      authMethod: "email",
    });
  });
}

/**
 * Create a template with a key/category that clearly contains "swms" so the
 * SWMS-detection logic recognises it.
 */
async function seedSwmsTemplate(
  t: ReturnType<typeof convexTest>,
  orgId: string,
) {
  return t.run(async (ctx) => {
    const templateId = await ctx.db.insert("templates", {
      orgId: orgId as Parameters<
        typeof ctx.db.insert<"templates">
      >[1]["orgId"],
      key: "construction.swms_template",
      name: "Safe Work Method Statement",
      category: "swms",
      industry: "construction",
      module: "safety",
      currentVersion: 1,
      status: "published",
    });

    const templateVersionId = await ctx.db.insert("templateVersions", {
      templateId,
      version: 1,
      sections: [],
      scoringEnabled: false,
    });

    return { templateId, templateVersionId };
  });
}

/**
 * Create a NON-SWMS template (neither key nor category contains "swms").
 */
async function seedNonSwmsTemplate(
  t: ReturnType<typeof convexTest>,
  orgId: string,
) {
  return t.run(async (ctx) => {
    const templateId = await ctx.db.insert("templates", {
      orgId: orgId as Parameters<
        typeof ctx.db.insert<"templates">
      >[1]["orgId"],
      key: "construction.daily_safety_walk",
      name: "Daily Safety Walk",
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

    return { templateId, templateVersionId };
  });
}

/**
 * Insert an inspection directly (avoids workflow.start / inspections.complete).
 * Supply anchorType and anchorId to attach it to a job.
 */
async function insertInspection(
  t: ReturnType<typeof convexTest>,
  p: {
    orgId: string;
    templateId: string;
    templateVersionId: string;
    inspectorId: string;
  },
  extra: Record<string, unknown> = {},
) {
  return t.run(async (ctx) => {
    type OrgId = Parameters<typeof ctx.db.insert<"inspections">>[1]["orgId"];
    type TemplateId = Parameters<
      typeof ctx.db.insert<"inspections">
    >[1]["templateId"];
    type TemplateVersionId = Parameters<
      typeof ctx.db.insert<"inspections">
    >[1]["templateVersionId"];
    type InspectorId = Parameters<
      typeof ctx.db.insert<"inspections">
    >[1]["inspectorId"];

    return ctx.db.insert("inspections", {
      orgId: p.orgId as OrgId,
      templateId: p.templateId as TemplateId,
      templateVersionId: p.templateVersionId as TemplateVersionId,
      version: 1,
      inspectorId: p.inspectorId as InspectorId,
      status: "in_progress",
      startedAt: Date.now(),
      responses: [],
      ...extra,
    } as Parameters<typeof ctx.db.insert<"inspections">>[1]);
  });
}

/**
 * Create a hrcw job for the given org.
 */
async function seedHrcwJob(
  t: ReturnType<typeof convexTest>,
  orgId: string,
  extra: Record<string, unknown> = {},
) {
  return t.run(async (ctx) => {
    return ctx.db.insert("jobs", {
      orgId: orgId as Parameters<typeof ctx.db.insert<"jobs">>[1]["orgId"],
      name: "HRCW Construction Job",
      status: "active",
      hrcw: true,
      ...extra,
    } as Parameters<typeof ctx.db.insert<"jobs">>[1]);
  });
}

/**
 * Seed a jurisdictionConfig row.
 */
async function seedJurisdictionConfig(
  t: ReturnType<typeof convexTest>,
  jurisdiction: "vic_ohs" | "whs_harmonised" | "generic",
  key: string,
  value: unknown,
) {
  return t.run(async (ctx) => {
    return ctx.db.insert("jurisdictionConfigs", {
      jurisdiction,
      key,
      value,
    });
  });
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// gates.jobReadiness — SWMS gate
// ---------------------------------------------------------------------------

describe("gates.jobReadiness — SWMS gate", () => {
  test("hrcw=true job with no inspections → ok=false, blocker 'Signed SWMS required'", async () => {
    const t = convexTest(schema, modules);
    const orgId = await seedOrg(t);
    const jobId = await seedHrcwJob(t, orgId);

    const result = await t.query(api.gates.jobReadiness, { jobId });

    expect(result.ok).toBe(false);
    expect(result.blockers).toContain("Signed SWMS required");
  });

  test("hrcw=true job with a non-SWMS inspection anchored to it → still blocked", async () => {
    const t = convexTest(schema, modules);
    const orgId = await seedOrg(t);
    const userId = await seedUser(t, orgId);
    const jobId = await seedHrcwJob(t, orgId);
    const { templateId, templateVersionId } = await seedNonSwmsTemplate(
      t,
      orgId,
    );

    // Anchor the inspection to the job but using a non-SWMS template.
    await insertInspection(
      t,
      { orgId, templateId, templateVersionId, inspectorId: userId },
      {
        anchorType: "job",
        anchorId: jobId,
        status: "completed",
        signOffs: [{ userId, at: Date.now() }],
      },
    );

    const result = await t.query(api.gates.jobReadiness, { jobId });

    expect(result.ok).toBe(false);
    expect(result.blockers).toContain("Signed SWMS required");
  });

  test("hrcw=true job with a SWMS inspection but status in_progress → still blocked", async () => {
    const t = convexTest(schema, modules);
    const orgId = await seedOrg(t);
    const userId = await seedUser(t, orgId);
    const jobId = await seedHrcwJob(t, orgId);
    const { templateId, templateVersionId } = await seedSwmsTemplate(
      t,
      orgId,
    );

    // SWMS inspection is still in_progress (not yet submitted/completed).
    await insertInspection(
      t,
      { orgId, templateId, templateVersionId, inspectorId: userId },
      {
        anchorType: "job",
        anchorId: jobId,
        status: "in_progress",
        signOffs: [{ userId, at: Date.now() }],
      },
    );

    const result = await t.query(api.gates.jobReadiness, { jobId });

    expect(result.ok).toBe(false);
    expect(result.blockers).toContain("Signed SWMS required");
  });

  test("hrcw=true job with a completed SWMS inspection but no signOffs → still blocked", async () => {
    const t = convexTest(schema, modules);
    const orgId = await seedOrg(t);
    const userId = await seedUser(t, orgId);
    const jobId = await seedHrcwJob(t, orgId);
    const { templateId, templateVersionId } = await seedSwmsTemplate(
      t,
      orgId,
    );

    // Completed SWMS but signOffs is empty.
    await insertInspection(
      t,
      { orgId, templateId, templateVersionId, inspectorId: userId },
      {
        anchorType: "job",
        anchorId: jobId,
        status: "completed",
        signOffs: [],
      },
    );

    const result = await t.query(api.gates.jobReadiness, { jobId });

    expect(result.ok).toBe(false);
    expect(result.blockers).toContain("Signed SWMS required");
  });

  test("hrcw=true job with a submitted SWMS inspection and signOff → ok=true, no blockers", async () => {
    const t = convexTest(schema, modules);
    const orgId = await seedOrg(t);
    const userId = await seedUser(t, orgId);
    const jobId = await seedHrcwJob(t, orgId);
    const { templateId, templateVersionId } = await seedSwmsTemplate(
      t,
      orgId,
    );

    // Submitted SWMS with one signOff — must satisfy the gate.
    await insertInspection(
      t,
      { orgId, templateId, templateVersionId, inspectorId: userId },
      {
        anchorType: "job",
        anchorId: jobId,
        status: "submitted",
        signOffs: [{ userId, at: Date.now() }],
      },
    );

    const result = await t.query(api.gates.jobReadiness, { jobId });

    expect(result.ok).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  test("hrcw=true job with a completed SWMS inspection and signOff → ok=true, no blockers", async () => {
    const t = convexTest(schema, modules);
    const orgId = await seedOrg(t);
    const userId = await seedUser(t, orgId);
    const jobId = await seedHrcwJob(t, orgId);
    const { templateId, templateVersionId } = await seedSwmsTemplate(
      t,
      orgId,
    );

    await insertInspection(
      t,
      { orgId, templateId, templateVersionId, inspectorId: userId },
      {
        anchorType: "job",
        anchorId: jobId,
        status: "completed",
        signOffs: [{ userId, at: Date.now() }],
      },
    );

    const result = await t.query(api.gates.jobReadiness, { jobId });

    expect(result.ok).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  test("hrcw=true job with a closed SWMS inspection and signOff → ok=true", async () => {
    const t = convexTest(schema, modules);
    const orgId = await seedOrg(t);
    const userId = await seedUser(t, orgId);
    const jobId = await seedHrcwJob(t, orgId);
    const { templateId, templateVersionId } = await seedSwmsTemplate(
      t,
      orgId,
    );

    await insertInspection(
      t,
      { orgId, templateId, templateVersionId, inspectorId: userId },
      {
        anchorType: "job",
        anchorId: jobId,
        status: "closed",
        signOffs: [{ userId, at: Date.now() }],
      },
    );

    const result = await t.query(api.gates.jobReadiness, { jobId });

    expect(result.ok).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  test("hrcw=true job with an actions_open SWMS inspection and signOff → ok=true", async () => {
    const t = convexTest(schema, modules);
    const orgId = await seedOrg(t);
    const userId = await seedUser(t, orgId);
    const jobId = await seedHrcwJob(t, orgId);
    const { templateId, templateVersionId } = await seedSwmsTemplate(
      t,
      orgId,
    );

    await insertInspection(
      t,
      { orgId, templateId, templateVersionId, inspectorId: userId },
      {
        anchorType: "job",
        anchorId: jobId,
        status: "actions_open",
        signOffs: [{ userId, at: Date.now() }],
      },
    );

    const result = await t.query(api.gates.jobReadiness, { jobId });

    expect(result.ok).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  test("hrcw=false job (no SWMS requirement) → ok=true, no blockers", async () => {
    const t = convexTest(schema, modules);
    const orgId = await seedOrg(t);

    const jobId = await t.run(async (ctx) => {
      return ctx.db.insert("jobs", {
        orgId: orgId as Parameters<
          typeof ctx.db.insert<"jobs">
        >[1]["orgId"],
        name: "Low-Risk Job",
        status: "active",
        hrcw: false,
      } as Parameters<typeof ctx.db.insert<"jobs">>[1]);
    });

    const result = await t.query(api.gates.jobReadiness, { jobId });

    expect(result.ok).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  test("job without hrcw field (undefined) → ok=true, no SWMS blocker", async () => {
    const t = convexTest(schema, modules);
    const orgId = await seedOrg(t);

    const jobId = await t.run(async (ctx) => {
      return ctx.db.insert("jobs", {
        orgId: orgId as Parameters<
          typeof ctx.db.insert<"jobs">
        >[1]["orgId"],
        name: "Standard Job",
        status: "draft",
        // hrcw intentionally omitted
      } as Parameters<typeof ctx.db.insert<"jobs">>[1]);
    });

    const result = await t.query(api.gates.jobReadiness, { jobId });

    expect(result.ok).toBe(true);
    expect(result.blockers).not.toContain("Signed SWMS required");
  });

  test("SWMS detection works when template category contains 'swms' (lowercase)", async () => {
    // The template category is "SWMS" (uppercase) — the gate must lowercase before matching.
    const t = convexTest(schema, modules);
    const orgId = await seedOrg(t);
    const userId = await seedUser(t, orgId);
    const jobId = await seedHrcwJob(t, orgId);

    const { templateId, templateVersionId } = await t.run(async (ctx) => {
      const templateId = await ctx.db.insert("templates", {
        orgId: orgId as Parameters<
          typeof ctx.db.insert<"templates">
        >[1]["orgId"],
        key: "construction.safe_work",
        name: "Safe Work Method Statement",
        category: "SWMS",          // uppercase — must still match
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
      return { templateId, templateVersionId };
    });

    await insertInspection(
      t,
      { orgId, templateId, templateVersionId, inspectorId: userId },
      {
        anchorType: "job",
        anchorId: jobId,
        status: "completed",
        signOffs: [{ userId, at: Date.now() }],
      },
    );

    const result = await t.query(api.gates.jobReadiness, { jobId });

    expect(result.ok).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  test("SWMS detection works when template key contains 'swms' (mixed case)", async () => {
    const t = convexTest(schema, modules);
    const orgId = await seedOrg(t);
    const userId = await seedUser(t, orgId);
    const jobId = await seedHrcwJob(t, orgId);

    const { templateId, templateVersionId } = await t.run(async (ctx) => {
      const templateId = await ctx.db.insert("templates", {
        orgId: orgId as Parameters<
          typeof ctx.db.insert<"templates">
        >[1]["orgId"],
        key: "Construction.SWMS_v2",   // uppercase in key
        name: "SWMS v2",
        category: "safety",            // category does NOT contain swms
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
      return { templateId, templateVersionId };
    });

    await insertInspection(
      t,
      { orgId, templateId, templateVersionId, inspectorId: userId },
      {
        anchorType: "job",
        anchorId: jobId,
        status: "completed",
        signOffs: [{ userId, at: Date.now() }],
      },
    );

    const result = await t.query(api.gates.jobReadiness, { jobId });

    expect(result.ok).toBe(true);
  });

  test("inspection anchored to a DIFFERENT job does NOT satisfy the gate", async () => {
    const t = convexTest(schema, modules);
    const orgId = await seedOrg(t);
    const userId = await seedUser(t, orgId);
    const jobA = await seedHrcwJob(t, orgId);
    const jobB = await seedHrcwJob(t, orgId);
    const { templateId, templateVersionId } = await seedSwmsTemplate(
      t,
      orgId,
    );

    // Anchor the SWMS inspection to jobB, not jobA.
    await insertInspection(
      t,
      { orgId, templateId, templateVersionId, inspectorId: userId },
      {
        anchorType: "job",
        anchorId: jobB,
        status: "completed",
        signOffs: [{ userId, at: Date.now() }],
      },
    );

    // jobA should still be blocked.
    const result = await t.query(api.gates.jobReadiness, { jobId: jobA });

    expect(result.ok).toBe(false);
    expect(result.blockers).toContain("Signed SWMS required");
  });
});

// ---------------------------------------------------------------------------
// gates.jobReadiness — licence gate (requiredEntryIds)
// ---------------------------------------------------------------------------

describe("gates.jobReadiness — licence gate", () => {
  test("expired registerEntry passed as requiredEntryIds → blocker 'Expired licence: <label>'", async () => {
    const t = convexTest(schema, modules);
    const orgId = await seedOrg(t);
    const userId = await seedUser(t, orgId);
    const jobId = await seedHrcwJob(t, orgId);

    // Insert a SWMS so the SWMS gate is cleared.
    const { templateId, templateVersionId } = await seedSwmsTemplate(
      t,
      orgId,
    );
    await insertInspection(
      t,
      { orgId, templateId, templateVersionId, inspectorId: userId },
      {
        anchorType: "job",
        anchorId: jobId,
        status: "completed",
        signOffs: [{ userId, at: Date.now() }],
      },
    );

    // Insert an expired licence register entry.
    const expiredEntryId = await t.run(async (ctx) => {
      return ctx.db.insert("registerEntries", {
        orgId: orgId as Parameters<
          typeof ctx.db.insert<"registerEntries">
        >[1]["orgId"],
        registerType: "licence",
        anchorType: "person",
        anchorId: userId,
        label: "Forklift Licence",
        expiresAt: Date.now() - 10 * MS_PER_DAY, // expired
      } as Parameters<typeof ctx.db.insert<"registerEntries">>[1]);
    });

    const result = await t.query(api.gates.jobReadiness, {
      jobId,
      requiredEntryIds: [expiredEntryId],
    });

    expect(result.ok).toBe(false);
    expect(result.blockers.some((b: string) => b.includes("Expired licence") && b.includes("Forklift Licence"))).toBe(true);
  });

  test("current registerEntry passed as requiredEntryIds → no licence blocker", async () => {
    const t = convexTest(schema, modules);
    const orgId = await seedOrg(t);
    const userId = await seedUser(t, orgId);
    const jobId = await seedHrcwJob(t, orgId);

    const { templateId, templateVersionId } = await seedSwmsTemplate(
      t,
      orgId,
    );
    await insertInspection(
      t,
      { orgId, templateId, templateVersionId, inspectorId: userId },
      {
        anchorType: "job",
        anchorId: jobId,
        status: "completed",
        signOffs: [{ userId, at: Date.now() }],
      },
    );

    // Insert a current licence (expires well in the future).
    const currentEntryId = await t.run(async (ctx) => {
      return ctx.db.insert("registerEntries", {
        orgId: orgId as Parameters<
          typeof ctx.db.insert<"registerEntries">
        >[1]["orgId"],
        registerType: "licence",
        anchorType: "person",
        anchorId: userId,
        label: "Elevated Work Platform",
        expiresAt: Date.now() + 365 * MS_PER_DAY, // well in the future
      } as Parameters<typeof ctx.db.insert<"registerEntries">>[1]);
    });

    const result = await t.query(api.gates.jobReadiness, {
      jobId,
      requiredEntryIds: [currentEntryId],
    });

    expect(result.ok).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  test("multiple requiredEntryIds — only expired ones produce blockers", async () => {
    const t = convexTest(schema, modules);
    const orgId = await seedOrg(t);
    const userId = await seedUser(t, orgId);
    const jobId = await seedHrcwJob(t, orgId);

    const { templateId, templateVersionId } = await seedSwmsTemplate(
      t,
      orgId,
    );
    await insertInspection(
      t,
      { orgId, templateId, templateVersionId, inspectorId: userId },
      {
        anchorType: "job",
        anchorId: jobId,
        status: "completed",
        signOffs: [{ userId, at: Date.now() }],
      },
    );

    const expiredId = await t.run(async (ctx) => {
      return ctx.db.insert("registerEntries", {
        orgId: orgId as Parameters<
          typeof ctx.db.insert<"registerEntries">
        >[1]["orgId"],
        registerType: "licence",
        anchorType: "person",
        anchorId: userId,
        label: "Crane Operator Licence",
        expiresAt: Date.now() - 5 * MS_PER_DAY,
      } as Parameters<typeof ctx.db.insert<"registerEntries">>[1]);
    });

    const currentId = await t.run(async (ctx) => {
      return ctx.db.insert("registerEntries", {
        orgId: orgId as Parameters<
          typeof ctx.db.insert<"registerEntries">
        >[1]["orgId"],
        registerType: "competency",
        anchorType: "person",
        anchorId: userId,
        label: "First Aid",
        expiresAt: Date.now() + 200 * MS_PER_DAY,
      } as Parameters<typeof ctx.db.insert<"registerEntries">>[1]);
    });

    const result = await t.query(api.gates.jobReadiness, {
      jobId,
      requiredEntryIds: [expiredId, currentId],
    });

    expect(result.ok).toBe(false);
    // Expired one should be in blockers.
    expect(result.blockers.some((b: string) => b.includes("Crane Operator Licence"))).toBe(true);
    // Current one should NOT be in blockers.
    expect(result.blockers.some((b: string) => b.includes("First Aid"))).toBe(false);
  });

  test("no requiredEntryIds provided → licence checks skipped entirely", async () => {
    const t = convexTest(schema, modules);
    const orgId = await seedOrg(t);
    const userId = await seedUser(t, orgId);
    const jobId = await seedHrcwJob(t, orgId);

    const { templateId, templateVersionId } = await seedSwmsTemplate(
      t,
      orgId,
    );
    await insertInspection(
      t,
      { orgId, templateId, templateVersionId, inspectorId: userId },
      {
        anchorType: "job",
        anchorId: jobId,
        status: "completed",
        signOffs: [{ userId, at: Date.now() }],
      },
    );

    // Even though this expired entry exists for the org, it's not in requiredEntryIds.
    await t.run(async (ctx) => {
      return ctx.db.insert("registerEntries", {
        orgId: orgId as Parameters<
          typeof ctx.db.insert<"registerEntries">
        >[1]["orgId"],
        registerType: "licence",
        anchorType: "person",
        anchorId: userId,
        label: "Expired But Not Required",
        expiresAt: Date.now() - 90 * MS_PER_DAY,
      } as Parameters<typeof ctx.db.insert<"registerEntries">>[1]);
    });

    // No requiredEntryIds → only SWMS gate runs.
    const result = await t.query(api.gates.jobReadiness, { jobId });

    expect(result.ok).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  test("both SWMS and licence blockers can be present simultaneously", async () => {
    const t = convexTest(schema, modules);
    const orgId = await seedOrg(t);
    const userId = await seedUser(t, orgId);
    const jobId = await seedHrcwJob(t, orgId);

    // No SWMS inspection → SWMS blocker.
    // Expired entry → licence blocker.

    const expiredId = await t.run(async (ctx) => {
      return ctx.db.insert("registerEntries", {
        orgId: orgId as Parameters<
          typeof ctx.db.insert<"registerEntries">
        >[1]["orgId"],
        registerType: "licence",
        anchorType: "person",
        anchorId: userId,
        label: "Rigging Licence",
        expiresAt: Date.now() - 1 * MS_PER_DAY,
      } as Parameters<typeof ctx.db.insert<"registerEntries">>[1]);
    });

    const result = await t.query(api.gates.jobReadiness, {
      jobId,
      requiredEntryIds: [expiredId],
    });

    expect(result.ok).toBe(false);
    expect(result.blockers).toContain("Signed SWMS required");
    expect(result.blockers.some((b: string) => b.includes("Rigging Licence"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// jobs.markReady
// ---------------------------------------------------------------------------

describe("jobs.markReady", () => {
  test("throws when job is blocked (hrcw=true, no SWMS) and swms_gate_block=true (default)", async () => {
    const t = convexTest(schema, modules);
    const orgId = await seedOrg(t);
    const jobId = await seedHrcwJob(t, orgId);

    await expect(
      t.mutation(api.jobs.markReady, { jobId }),
    ).rejects.toThrow();
  });

  test("thrown error includes blocker reason when blocked", async () => {
    const t = convexTest(schema, modules);
    const orgId = await seedOrg(t);
    const jobId = await seedHrcwJob(t, orgId);

    // markReady must throw when blocked. The error (message or serialised data)
    // must somehow communicate the reason — expected to contain "swms", "blocker",
    // or "required". We serialise both .message and the full Error to maximise
    // the chance of matching a ConvexError whose data is embedded differently.
    await expect(
      t.mutation(api.jobs.markReady, { jobId }),
    ).rejects.toSatisfy((e: unknown) => {
      const asString = (
        String(e) +
        (e instanceof Error ? e.message : "") +
        JSON.stringify(e)
      ).toLowerCase();
      return (
        asString.includes("swms") ||
        asString.includes("blocker") ||
        asString.includes("required")
      );
    });
  });

  test("sets startedReady=true when all gates are clear", async () => {
    const t = convexTest(schema, modules);
    const orgId = await seedOrg(t);
    const userId = await seedUser(t, orgId);
    const jobId = await seedHrcwJob(t, orgId);
    const { templateId, templateVersionId } = await seedSwmsTemplate(
      t,
      orgId,
    );

    await insertInspection(
      t,
      { orgId, templateId, templateVersionId, inspectorId: userId },
      {
        anchorType: "job",
        anchorId: jobId,
        status: "completed",
        signOffs: [{ userId, at: Date.now() }],
      },
    );

    await t.mutation(api.jobs.markReady, { jobId });

    const job = await t.run(async (ctx) => ctx.db.get(jobId as Parameters<typeof ctx.db.get>[0]));
    expect(job).not.toBeNull();
    expect((job as Record<string, unknown>).startedReady).toBe(true);
  });

  test("does NOT set startedReady when blocked and hard-block is on (default)", async () => {
    const t = convexTest(schema, modules);
    const orgId = await seedOrg(t);
    const jobId = await seedHrcwJob(t, orgId);

    // Attempt markReady — should throw.
    try {
      await t.mutation(api.jobs.markReady, { jobId });
    } catch {
      // expected
    }

    const job = await t.run(async (ctx) => ctx.db.get(jobId as Parameters<typeof ctx.db.get>[0]));
    // startedReady should still be falsy (not set).
    expect((job as Record<string, unknown>).startedReady).toBeFalsy();
  });

  test("soft gate (swms_gate_block=false): sets startedReady=true even when blocked and returns blockers", async () => {
    const t = convexTest(schema, modules);
    const orgId = await seedOrg(t);
    const jobId = await seedHrcwJob(t, orgId);

    // Set swms_gate_block=false for the generic jurisdiction.
    await seedJurisdictionConfig(t, "generic", "swms_gate_block", false);

    // Should NOT throw with soft gate.
    const result = await t.mutation(api.jobs.markReady, { jobId });

    // startedReady must be set even though the SWMS gate was not cleared.
    const job = await t.run(async (ctx) => ctx.db.get(jobId as Parameters<typeof ctx.db.get>[0]));
    expect((job as Record<string, unknown>).startedReady).toBe(true);

    // Result should still report the blockers.
    if (result !== undefined) {
      expect((result as { ok: boolean }).ok).toBe(false);
    }
  });

  test("non-hrcw job: markReady sets startedReady without needing a SWMS", async () => {
    const t = convexTest(schema, modules);
    const orgId = await seedOrg(t);

    const jobId = await t.run(async (ctx) => {
      return ctx.db.insert("jobs", {
        orgId: orgId as Parameters<
          typeof ctx.db.insert<"jobs">
        >[1]["orgId"],
        name: "Non-HRCW Job",
        status: "active",
        hrcw: false,
      } as Parameters<typeof ctx.db.insert<"jobs">>[1]);
    });

    await t.mutation(api.jobs.markReady, { jobId });

    const job = await t.run(async (ctx) => ctx.db.get(jobId as Parameters<typeof ctx.db.get>[0]));
    expect((job as Record<string, unknown>).startedReady).toBe(true);
  });

  test("markReady throws for a blocked job with expired licences", async () => {
    const t = convexTest(schema, modules);
    const orgId = await seedOrg(t);
    const userId = await seedUser(t, orgId);
    const jobId = await seedHrcwJob(t, orgId);

    // Satisfy SWMS gate.
    const { templateId, templateVersionId } = await seedSwmsTemplate(
      t,
      orgId,
    );
    await insertInspection(
      t,
      { orgId, templateId, templateVersionId, inspectorId: userId },
      {
        anchorType: "job",
        anchorId: jobId,
        status: "completed",
        signOffs: [{ userId, at: Date.now() }],
      },
    );

    // Insert expired licence.
    const expiredId = await t.run(async (ctx) => {
      return ctx.db.insert("registerEntries", {
        orgId: orgId as Parameters<
          typeof ctx.db.insert<"registerEntries">
        >[1]["orgId"],
        registerType: "licence",
        anchorType: "person",
        anchorId: userId,
        label: "Scaffolding Licence",
        expiresAt: Date.now() - 2 * MS_PER_DAY,
      } as Parameters<typeof ctx.db.insert<"registerEntries">>[1]);
    });

    await expect(
      t.mutation(api.jobs.markReady, { jobId, requiredEntryIds: [expiredId] }),
    ).rejects.toThrow();
  });
});

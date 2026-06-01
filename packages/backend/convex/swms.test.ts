/**
 * Tests for SWMS as a first-class record (spec §9, DoD #7).
 *
 * Intended API (to be implemented):
 *
 * 1. convex/schema.ts — questionType union:
 *    - ADD v.literal("controlMeasure")
 *      A controlMeasure answer captures: hazard → risk rating → control,
 *      following the hierarchy of controls.
 *
 * 2. convex/schema.ts — inspections table:
 *    - ADD OPTIONAL principalContractorId: v.optional(v.id("contracts"))
 *    - ADD OPTIONAL swmsSharedAt: v.optional(v.number())
 *
 * 3. convex/lib/hierarchyOfControl.ts — pure helpers (no Convex imports):
 *    - HIERARCHY: string[] =
 *        ["elimination","substitution","isolation","engineering","admin","ppe"]
 *    - hierarchyRank(level: string): number
 *        returns the 0-based index of `level` in HIERARCHY, or -1 if unknown
 *    - isStrongerOrEqual(a: string, b: string): boolean
 *        returns true when hierarchyRank(a) <= hierarchyRank(b)
 *        (lower index = stronger control)
 *        returns false if either level is unknown (rank === -1)
 *
 * 4. convex/swms.ts — mutations:
 *    - swms.shareToPrincipal({ inspectionId, principalContractorId })
 *        sets principalContractorId and swmsSharedAt = Date.now() on the inspection
 *        inserts exactly one auditLog row with action "swms.shared_with_principal"
 *        returns { sharedAt: number }
 *
 * convex-test safe:
 *  - Inspections/templates inserted directly via t.run / ctx.db.insert
 *  - No component calls, no workflow.start, no inspections.complete
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
// hierarchyOfControl — pure unit tests (imported directly, no Convex harness)
// ---------------------------------------------------------------------------

async function loadHierarchyOfControl() {
  const mod = await import("./lib/hierarchyOfControl");
  return mod as {
    HIERARCHY: string[];
    hierarchyRank: (level: string) => number;
    isStrongerOrEqual: (a: string, b: string) => boolean;
  };
}

describe("hierarchyOfControl.HIERARCHY", () => {
  test("exports HIERARCHY array with 6 levels in the correct order", async () => {
    const { HIERARCHY } = await loadHierarchyOfControl();
    expect(Array.isArray(HIERARCHY)).toBe(true);
    expect(HIERARCHY).toEqual([
      "elimination",
      "substitution",
      "isolation",
      "engineering",
      "admin",
      "ppe",
    ]);
  });
});

describe("hierarchyOfControl.hierarchyRank", () => {
  test("elimination is rank 0 (strongest)", async () => {
    const { hierarchyRank } = await loadHierarchyOfControl();
    expect(hierarchyRank("elimination")).toBe(0);
  });

  test("substitution is rank 1", async () => {
    const { hierarchyRank } = await loadHierarchyOfControl();
    expect(hierarchyRank("substitution")).toBe(1);
  });

  test("isolation is rank 2", async () => {
    const { hierarchyRank } = await loadHierarchyOfControl();
    expect(hierarchyRank("isolation")).toBe(2);
  });

  test("engineering is rank 3", async () => {
    const { hierarchyRank } = await loadHierarchyOfControl();
    expect(hierarchyRank("engineering")).toBe(3);
  });

  test("admin is rank 4", async () => {
    const { hierarchyRank } = await loadHierarchyOfControl();
    expect(hierarchyRank("admin")).toBe(4);
  });

  test("ppe is rank 5 (weakest)", async () => {
    const { hierarchyRank } = await loadHierarchyOfControl();
    expect(hierarchyRank("ppe")).toBe(5);
  });

  test("unknown level returns -1", async () => {
    const { hierarchyRank } = await loadHierarchyOfControl();
    expect(hierarchyRank("unknown_level")).toBe(-1);
    expect(hierarchyRank("")).toBe(-1);
    expect(hierarchyRank("PPE")).toBe(-1); // case-sensitive
  });
});

describe("hierarchyOfControl.isStrongerOrEqual", () => {
  test("elimination is stronger than ppe", async () => {
    const { isStrongerOrEqual } = await loadHierarchyOfControl();
    expect(isStrongerOrEqual("elimination", "ppe")).toBe(true);
  });

  test("ppe is NOT stronger than elimination", async () => {
    const { isStrongerOrEqual } = await loadHierarchyOfControl();
    expect(isStrongerOrEqual("ppe", "elimination")).toBe(false);
  });

  test("same level is equal (strong or equal)", async () => {
    const { isStrongerOrEqual } = await loadHierarchyOfControl();
    expect(isStrongerOrEqual("engineering", "engineering")).toBe(true);
    expect(isStrongerOrEqual("elimination", "elimination")).toBe(true);
    expect(isStrongerOrEqual("ppe", "ppe")).toBe(true);
  });

  test("elimination is stronger than admin", async () => {
    const { isStrongerOrEqual } = await loadHierarchyOfControl();
    expect(isStrongerOrEqual("elimination", "admin")).toBe(true);
  });

  test("substitution is stronger than engineering", async () => {
    const { isStrongerOrEqual } = await loadHierarchyOfControl();
    expect(isStrongerOrEqual("substitution", "engineering")).toBe(true);
  });

  test("admin is NOT stronger than isolation", async () => {
    const { isStrongerOrEqual } = await loadHierarchyOfControl();
    expect(isStrongerOrEqual("admin", "isolation")).toBe(false);
  });

  test("unknown level a returns false", async () => {
    const { isStrongerOrEqual } = await loadHierarchyOfControl();
    expect(isStrongerOrEqual("unknown", "elimination")).toBe(false);
  });

  test("unknown level b returns false", async () => {
    const { isStrongerOrEqual } = await loadHierarchyOfControl();
    expect(isStrongerOrEqual("elimination", "unknown")).toBe(false);
  });

  test("both unknown levels returns false", async () => {
    const { isStrongerOrEqual } = await loadHierarchyOfControl();
    expect(isStrongerOrEqual("unknown_a", "unknown_b")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Helpers for Convex tests
// ---------------------------------------------------------------------------

async function seedPrerequisites(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      name: "SWMS Test Org",
      slug: "swms-test-org",
      plan: "free",
    });

    const userId = await ctx.db.insert("users", {
      orgId,
      name: "SWMS Inspector",
      authMethod: "email",
    });

    const contractId = await ctx.db.insert("contracts", {
      orgId,
      name: "Principal Contractor Ltd",
      status: "active",
    });

    // Template with a controlMeasure question.
    const templateId = await ctx.db.insert("templates", {
      orgId,
      key: "swms.test_template",
      name: "SWMS Test Template",
      category: "safety",
      industry: "construction",
      currentVersion: 1,
      status: "published",
    });

    const templateVersionId = await ctx.db.insert("templateVersions", {
      templateId,
      version: 1,
      sections: [
        {
          id: "section-1",
          title: "Hazard Controls",
          questions: [
            {
              id: "q-control-1",
              label: "Working at heights — control measure",
              // "controlMeasure" is the new questionType union member being added.
              type: "controlMeasure" as Parameters<typeof ctx.db.insert>[1] extends { sections: infer S } ? never : never,
            },
          ],
        },
      ],
      scoringEnabled: false,
    });

    return { orgId, userId, contractId, templateId, templateVersionId };
  });
}

/**
 * Insert an in_progress inspection directly (no workflow/complete() call).
 */
async function insertInspection(
  t: ReturnType<typeof convexTest>,
  p: Awaited<ReturnType<typeof seedPrerequisites>>,
  extra: Record<string, unknown> = {},
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
      ...extra,
    } as Parameters<typeof ctx.db.insert<"inspections">>[1]);
  });
}

// ---------------------------------------------------------------------------
// Schema: controlMeasure question type
// ---------------------------------------------------------------------------

describe("schema: controlMeasure questionType", () => {
  test("a templateVersion with a controlMeasure question can be inserted without schema error", async () => {
    const t = convexTest(schema, modules);

    const orgId = await t.run(async (ctx) =>
      ctx.db.insert("organizations", {
        name: "Schema Test Org",
        slug: "schema-test-org-swms",
        plan: "free",
      }),
    );

    const templateId = await t.run(async (ctx) =>
      ctx.db.insert("templates", {
        orgId,
        key: "schema.control_measure_test",
        name: "Control Measure Schema Test",
        category: "safety",
        industry: "construction",
        currentVersion: 1,
        status: "published",
      }),
    );

    // This insert should NOT throw — "controlMeasure" must be a valid questionType literal.
    const tvId = await t.run(async (ctx) =>
      ctx.db.insert("templateVersions", {
        templateId,
        version: 1,
        sections: [
          {
            id: "s1",
            title: "Hazards",
            questions: [
              {
                id: "q1",
                label: "Identify and rate the hazard",
                type: "controlMeasure" as Parameters<typeof ctx.db.insert>[1] extends never ? never : string,
              },
            ],
          },
        ],
        scoringEnabled: false,
      } as Parameters<typeof ctx.db.insert<"templateVersions">>[1]),
    );

    const tv = await t.run(async (ctx) => ctx.db.get(tvId));
    expect(tv).not.toBeNull();
    const q = (tv!.sections[0] as { questions: Array<{ type: string }> }).questions[0];
    expect(q.type).toBe("controlMeasure");
  });

  test("a template with a mixed section (controlMeasure + passFailNA questions) is valid", async () => {
    const t = convexTest(schema, modules);

    const orgId = await t.run(async (ctx) =>
      ctx.db.insert("organizations", {
        name: "Mixed Schema Org",
        slug: "mixed-schema-org-swms",
        plan: "free",
      }),
    );

    const templateId = await t.run(async (ctx) =>
      ctx.db.insert("templates", {
        orgId,
        key: "schema.mixed_test",
        name: "Mixed Questions Test",
        category: "safety",
        industry: "construction",
        currentVersion: 1,
        status: "published",
      }),
    );

    await expect(
      t.run(async (ctx) =>
        ctx.db.insert("templateVersions", {
          templateId,
          version: 1,
          sections: [
            {
              id: "s1",
              title: "Mixed Section",
              questions: [
                {
                  id: "q1",
                  label: "Height work hazard",
                  type: "controlMeasure" as Parameters<typeof ctx.db.insert>[1] extends never ? never : string,
                },
                {
                  id: "q2",
                  label: "PPE worn correctly?",
                  type: "passFailNA",
                },
              ],
            },
          ],
          scoringEnabled: false,
        } as Parameters<typeof ctx.db.insert<"templateVersions">>[1]),
      ),
    ).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Schema: inspections — new SWMS fields
// ---------------------------------------------------------------------------

describe("schema: inspections SWMS fields", () => {
  test("inspection can be inserted with principalContractorId field", async () => {
    const t = convexTest(schema, modules);
    const prereqs = await seedPrerequisites(t);

    await expect(
      insertInspection(t, prereqs, {
        principalContractorId: prereqs.contractId,
      }),
    ).resolves.not.toThrow();
  });

  test("inspection can be inserted with swmsSharedAt field", async () => {
    const t = convexTest(schema, modules);
    const prereqs = await seedPrerequisites(t);
    const sharedAt = Date.now();

    const id = await insertInspection(t, prereqs, {
      principalContractorId: prereqs.contractId,
      swmsSharedAt: sharedAt,
    });

    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row).not.toBeNull();
    expect((row as Record<string, unknown>).swmsSharedAt).toBe(sharedAt);
    expect((row as Record<string, unknown>).principalContractorId).toBe(prereqs.contractId);
  });

  test("inspection without SWMS fields still inserts cleanly (fields are optional)", async () => {
    const t = convexTest(schema, modules);
    const prereqs = await seedPrerequisites(t);

    const id = await insertInspection(t, prereqs);

    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row).not.toBeNull();
    expect((row as Record<string, unknown>).principalContractorId).toBeUndefined();
    expect((row as Record<string, unknown>).swmsSharedAt).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// swms.shareToPrincipal
// ---------------------------------------------------------------------------

describe("swms.shareToPrincipal", () => {
  test("sets principalContractorId and swmsSharedAt on the inspection", async () => {
    const t = convexTest(schema, modules);
    const prereqs = await seedPrerequisites(t);
    const inspectionId = await insertInspection(t, prereqs);

    const before = Date.now();
    const result = await t.mutation(api.swms.shareToPrincipal, {
      inspectionId,
      principalContractorId: prereqs.contractId,
    });
    const after = Date.now();

    expect(result).toHaveProperty("sharedAt");
    expect(typeof result.sharedAt).toBe("number");
    expect(result.sharedAt).toBeGreaterThanOrEqual(before);
    expect(result.sharedAt).toBeLessThanOrEqual(after);

    const row = await t.run(async (ctx) => ctx.db.get(inspectionId));
    expect(row).not.toBeNull();
    expect((row as Record<string, unknown>).principalContractorId).toBe(prereqs.contractId);
    expect((row as Record<string, unknown>).swmsSharedAt).toBe(result.sharedAt);
  });

  test("inserts exactly one auditLog entry with action 'swms.shared_with_principal'", async () => {
    const t = convexTest(schema, modules);
    const prereqs = await seedPrerequisites(t);
    const inspectionId = await insertInspection(t, prereqs);

    await t.mutation(api.swms.shareToPrincipal, {
      inspectionId,
      principalContractorId: prereqs.contractId,
    });

    const logs = await t.run(async (ctx) =>
      ctx.db
        .query("auditLog")
        .withIndex("by_entity", (q) =>
          q.eq("entityTable", "inspections").eq("entityId", inspectionId),
        )
        .collect(),
    );

    // Exactly one audit log entry.
    expect(logs.length).toBe(1);
    expect(logs[0].action).toBe("swms.shared_with_principal");
    expect(logs[0].orgId).toBe(prereqs.orgId);
  });

  test("auditLog entry entityTable and entityId match the inspection", async () => {
    const t = convexTest(schema, modules);
    const prereqs = await seedPrerequisites(t);
    const inspectionId = await insertInspection(t, prereqs);

    await t.mutation(api.swms.shareToPrincipal, {
      inspectionId,
      principalContractorId: prereqs.contractId,
    });

    const log = await t.run(async (ctx) =>
      ctx.db
        .query("auditLog")
        .withIndex("by_entity", (q) =>
          q.eq("entityTable", "inspections").eq("entityId", inspectionId),
        )
        .unique(),
    );

    expect(log).not.toBeNull();
    expect(log!.entityTable).toBe("inspections");
    expect(log!.entityId).toBe(inspectionId);
  });

  test("re-sharing updates swmsSharedAt and still has exactly one auditLog entry per call", async () => {
    const t = convexTest(schema, modules);
    const prereqs = await seedPrerequisites(t);
    const inspectionId = await insertInspection(t, prereqs);

    const first = await t.mutation(api.swms.shareToPrincipal, {
      inspectionId,
      principalContractorId: prereqs.contractId,
    });

    // A small artificial delay so the two timestamps differ (epoch ms resolution).
    const second = await t.mutation(api.swms.shareToPrincipal, {
      inspectionId,
      principalContractorId: prereqs.contractId,
    });

    // swmsSharedAt must be updated to the most recent call.
    expect(second.sharedAt).toBeGreaterThanOrEqual(first.sharedAt);

    const row = await t.run(async (ctx) => ctx.db.get(inspectionId));
    expect((row as Record<string, unknown>).swmsSharedAt).toBe(second.sharedAt);

    // Two audit log entries — one per call.
    const logs = await t.run(async (ctx) =>
      ctx.db
        .query("auditLog")
        .withIndex("by_entity", (q) =>
          q.eq("entityTable", "inspections").eq("entityId", inspectionId),
        )
        .collect(),
    );
    expect(logs.length).toBe(2);
    expect(logs.every((l) => l.action === "swms.shared_with_principal")).toBe(true);
  });

  test("throws when inspection does not exist", async () => {
    const t = convexTest(schema, modules);
    const prereqs = await seedPrerequisites(t);

    // Use a real-looking but non-existent inspection id.
    const fakeInspectionId = prereqs.contractId as unknown as Parameters<
      typeof api.swms.shareToPrincipal._args
    >[0]["inspectionId"];

    await expect(
      t.mutation(api.swms.shareToPrincipal, {
        inspectionId: fakeInspectionId,
        principalContractorId: prereqs.contractId,
      }),
    ).rejects.toThrow();
  });

  test("shareToPrincipal returns sharedAt matching the persisted swmsSharedAt", async () => {
    const t = convexTest(schema, modules);
    const prereqs = await seedPrerequisites(t);
    const inspectionId = await insertInspection(t, prereqs);

    const { sharedAt } = await t.mutation(api.swms.shareToPrincipal, {
      inspectionId,
      principalContractorId: prereqs.contractId,
    });

    const row = await t.run(async (ctx) => ctx.db.get(inspectionId));
    expect((row as Record<string, unknown>).swmsSharedAt).toBe(sharedAt);
  });
});

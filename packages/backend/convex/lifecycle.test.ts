/**
 * Tests for Inspection lifecycle status machine + sign-on (spec §5.2, §7).
 *
 * Intended API (to be implemented):
 *
 * convex/schema.ts — additive/backward-compatible additions to `inspections` table:
 *   - status union: EXTEND to also include "scheduled"|"actions_open"|"closed"|"overdue"
 *     (keep existing in_progress|completed|submitted)
 *   - NEW optional fields:
 *       dueAt?: v.number()           (already exists — confirm it is present)
 *       scheduledAt?: v.number()
 *       submittedAt?: v.number()
 *       completedBy?: v.id("users")
 *       signOffs?: v.array(v.object({
 *         userId: v.id("users"),
 *         role?: v.string(),
 *         signatureMediaId?: v.id("media"),
 *         at: v.number(),
 *       }))
 *
 * convex/lib/lifecycle.ts — pure helpers (no Convex imports):
 *   `statusAfterComplete(hasOpenActions: boolean)` → "actions_open" | "closed"
 *   `canTransition(from: InspectionStatus, to: InspectionStatus)` → boolean
 *     Documented flow:
 *       scheduled   → in_progress
 *       in_progress → submitted | completed
 *       submitted   → completed          (e.g. manager sign-off turns submit into complete)
 *       completed   → actions_open | closed
 *       actions_open → closed
 *       * (any)     → overdue            (overdue reachable from scheduled or in_progress)
 *       Everything else: false
 *
 * convex/inspections.ts — new mutations:
 *   `inspections.signOn({ inspectionId, userId, role?, signatureMediaId? })`
 *     - Appends a sign-off entry to the inspection's signOffs array.
 *     - Does NOT call workflow / scoreByOrg / scoreBySite / components.
 *     - Returns { ok: true }.
 *
 *   `inspections.closeIfResolved({ inspectionId })`
 *     - Reads all `actions` rows where inspectionId matches.
 *     - If ALL such actions have status "verified" (or there are no actions): sets status → "closed".
 *     - If any action is NOT "verified": sets status → "actions_open".
 *     - Pure db reads/writes — no components.
 *     - Returns { status: "closed" | "actions_open" }.
 *
 * convex-test safe:
 *  - lifecycle.ts pure unit tests — direct import, no Convex harness.
 *  - signOn / closeIfResolved tests use ctx.db.insert + t.mutation + t.run only.
 *  - No inspections.complete(), no workflow.start, no scoreByOrg/scoreBySite.
 *  - Inspections and actions inserted directly via t.run(ctx.db.insert).
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
// Dynamic imports for pure lifecycle helpers
// ---------------------------------------------------------------------------

async function loadLifecycle() {
  const mod = await import("./lib/lifecycle");
  return mod as {
    statusAfterComplete: (hasOpenActions: boolean) => "actions_open" | "closed";
    canTransition: (from: string, to: string) => boolean;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedOrg(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      name: "Lifecycle Test Org",
      slug: `lifecycle-test-${Math.random().toString(36).slice(2)}`,
      plan: "free",
    });

    const userId = await ctx.db.insert("users", {
      orgId,
      name: "Test Inspector",
      authMethod: "email",
    });

    const templateId = await ctx.db.insert("templates", {
      orgId,
      key: "lifecycle.test_template",
      name: "Lifecycle Test Template",
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
 * Insert an inspection directly via ctx.db (never call inspections.start — see CLAUDE.md).
 * The status union is cast permissively so tests can insert new statuses before the schema
 * is extended — the "right red" failure will be a schema validation error, not a TS compile error.
 */
async function insertInspection(
  t: ReturnType<typeof convexTest>,
  fields: {
    orgId: string;
    userId: string;
    templateId: string;
    templateVersionId: string;
    status?: string;
    signOffs?: Array<{
      userId: string;
      role?: string;
      at: number;
    }>;
    scheduledAt?: number;
    submittedAt?: number;
    completedBy?: string;
  },
) {
  return t.run(async (ctx) => {
    return ctx.db.insert("inspections", {
      orgId: fields.orgId as Parameters<typeof ctx.db.insert<"inspections">>[1] extends { orgId: infer O } ? O : never,
      templateId: fields.templateId as Parameters<typeof ctx.db.insert<"inspections">>[1] extends { templateId: infer T } ? T : never,
      templateVersionId: fields.templateVersionId as Parameters<typeof ctx.db.insert<"inspections">>[1] extends { templateVersionId: infer T } ? T : never,
      version: 1,
      inspectorId: fields.userId as Parameters<typeof ctx.db.insert<"inspections">>[1] extends { inspectorId: infer T } ? T : never,
      status: (fields.status ?? "in_progress") as Parameters<typeof ctx.db.insert<"inspections">>[1] extends { status: infer S } ? S : never,
      startedAt: Date.now() - 60_000,
      responses: [],
      ...(fields.scheduledAt !== undefined ? { scheduledAt: fields.scheduledAt } : {}),
      ...(fields.submittedAt !== undefined ? { submittedAt: fields.submittedAt } : {}),
      ...(fields.completedBy !== undefined ? { completedBy: fields.completedBy as Parameters<typeof ctx.db.insert<"inspections">>[1] extends { completedBy: infer C } ? C : never } : {}),
      ...(fields.signOffs !== undefined ? { signOffs: fields.signOffs as Parameters<typeof ctx.db.insert<"inspections">>[1] extends { signOffs: infer S } ? S : never } : {}),
    } as Parameters<typeof ctx.db.insert<"inspections">>[1]);
  });
}

/** Insert an action tied to an inspection directly via ctx.db. */
async function insertAction(
  t: ReturnType<typeof convexTest>,
  fields: {
    orgId: string;
    inspectionId: string;
    status: string;
    title?: string;
  },
) {
  return t.run(async (ctx) => {
    return ctx.db.insert("actions", {
      orgId: fields.orgId as Parameters<typeof ctx.db.insert<"actions">>[1] extends { orgId: infer O } ? O : never,
      title: fields.title ?? "Test action",
      status: fields.status as Parameters<typeof ctx.db.insert<"actions">>[1] extends { status: infer S } ? S : never,
      priority: "medium",
      source: "inspection",
      inspectionId: fields.inspectionId as Parameters<typeof ctx.db.insert<"actions">>[1] extends { inspectionId: infer I } ? I : never,
    } as Parameters<typeof ctx.db.insert<"actions">>[1]);
  });
}

// ===========================================================================
// SECTION 1: Pure lifecycle helpers — convex/lib/lifecycle.ts
// ===========================================================================

describe("lifecycle.statusAfterComplete — pure logic", () => {
  test("returns 'actions_open' when hasOpenActions is true", async () => {
    const { statusAfterComplete } = await loadLifecycle();
    expect(statusAfterComplete(true)).toBe("actions_open");
  });

  test("returns 'closed' when hasOpenActions is false", async () => {
    const { statusAfterComplete } = await loadLifecycle();
    expect(statusAfterComplete(false)).toBe("closed");
  });

  test("return type is one of the two valid statuses", async () => {
    const { statusAfterComplete } = await loadLifecycle();
    const r1 = statusAfterComplete(true);
    const r2 = statusAfterComplete(false);
    expect(["actions_open", "closed"]).toContain(r1);
    expect(["actions_open", "closed"]).toContain(r2);
  });
});

describe("lifecycle.canTransition — documented happy paths", () => {
  test("scheduled → in_progress is allowed", async () => {
    const { canTransition } = await loadLifecycle();
    expect(canTransition("scheduled", "in_progress")).toBe(true);
  });

  test("in_progress → submitted is allowed", async () => {
    const { canTransition } = await loadLifecycle();
    expect(canTransition("in_progress", "submitted")).toBe(true);
  });

  test("in_progress → completed is allowed", async () => {
    const { canTransition } = await loadLifecycle();
    expect(canTransition("in_progress", "completed")).toBe(true);
  });

  test("submitted → completed is allowed (manager sign-off)", async () => {
    const { canTransition } = await loadLifecycle();
    expect(canTransition("submitted", "completed")).toBe(true);
  });

  test("completed → actions_open is allowed", async () => {
    const { canTransition } = await loadLifecycle();
    expect(canTransition("completed", "actions_open")).toBe(true);
  });

  test("completed → closed is allowed", async () => {
    const { canTransition } = await loadLifecycle();
    expect(canTransition("completed", "closed")).toBe(true);
  });

  test("actions_open → closed is allowed", async () => {
    const { canTransition } = await loadLifecycle();
    expect(canTransition("actions_open", "closed")).toBe(true);
  });

  test("scheduled → overdue is allowed (overdue reachable from scheduled)", async () => {
    const { canTransition } = await loadLifecycle();
    expect(canTransition("scheduled", "overdue")).toBe(true);
  });

  test("in_progress → overdue is allowed (overdue reachable from in_progress)", async () => {
    const { canTransition } = await loadLifecycle();
    expect(canTransition("in_progress", "overdue")).toBe(true);
  });
});

describe("lifecycle.canTransition — disallowed paths", () => {
  test("closed → in_progress is NOT allowed", async () => {
    const { canTransition } = await loadLifecycle();
    expect(canTransition("closed", "in_progress")).toBe(false);
  });

  test("completed → in_progress is NOT allowed", async () => {
    const { canTransition } = await loadLifecycle();
    expect(canTransition("completed", "in_progress")).toBe(false);
  });

  test("submitted → scheduled is NOT allowed", async () => {
    const { canTransition } = await loadLifecycle();
    expect(canTransition("submitted", "scheduled")).toBe(false);
  });

  test("closed → overdue is NOT allowed", async () => {
    const { canTransition } = await loadLifecycle();
    expect(canTransition("closed", "overdue")).toBe(false);
  });

  test("actions_open → in_progress is NOT allowed", async () => {
    const { canTransition } = await loadLifecycle();
    expect(canTransition("actions_open", "in_progress")).toBe(false);
  });

  test("overdue → scheduled is NOT allowed", async () => {
    const { canTransition } = await loadLifecycle();
    expect(canTransition("overdue", "scheduled")).toBe(false);
  });

  test("same-state transition (in_progress → in_progress) is NOT allowed", async () => {
    const { canTransition } = await loadLifecycle();
    expect(canTransition("in_progress", "in_progress")).toBe(false);
  });

  test("same-state transition (closed → closed) is NOT allowed", async () => {
    const { canTransition } = await loadLifecycle();
    expect(canTransition("closed", "closed")).toBe(false);
  });
});

// ===========================================================================
// SECTION 2: Schema — new status values and optional fields
// ===========================================================================

describe("inspections schema — new status literals", () => {
  test("can insert an inspection with status 'scheduled'", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId, templateId, templateVersionId } = await seedOrg(t);

    // This MUST fail until the schema extends the status union to include "scheduled".
    const id = await insertInspection(t, {
      orgId,
      userId,
      templateId,
      templateVersionId,
      status: "scheduled",
    });

    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row).not.toBeNull();
    expect(row!.status).toBe("scheduled");
  });

  test("can insert an inspection with status 'actions_open'", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId, templateId, templateVersionId } = await seedOrg(t);

    const id = await insertInspection(t, {
      orgId,
      userId,
      templateId,
      templateVersionId,
      status: "actions_open",
    });

    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row).not.toBeNull();
    expect(row!.status).toBe("actions_open");
  });

  test("can insert an inspection with status 'closed'", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId, templateId, templateVersionId } = await seedOrg(t);

    const id = await insertInspection(t, {
      orgId,
      userId,
      templateId,
      templateVersionId,
      status: "closed",
    });

    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row).not.toBeNull();
    expect(row!.status).toBe("closed");
  });

  test("can insert an inspection with status 'overdue'", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId, templateId, templateVersionId } = await seedOrg(t);

    const id = await insertInspection(t, {
      orgId,
      userId,
      templateId,
      templateVersionId,
      status: "overdue",
    });

    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row).not.toBeNull();
    expect(row!.status).toBe("overdue");
  });
});

describe("inspections schema — new optional fields", () => {
  test("can store and retrieve scheduledAt", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId, templateId, templateVersionId } = await seedOrg(t);
    const scheduledAt = Date.now() + 24 * 60 * 60 * 1000;

    const id = await insertInspection(t, {
      orgId,
      userId,
      templateId,
      templateVersionId,
      status: "scheduled",
      scheduledAt,
    });

    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row!.scheduledAt).toBe(scheduledAt);
  });

  test("can store and retrieve submittedAt", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId, templateId, templateVersionId } = await seedOrg(t);
    const submittedAt = Date.now();

    const id = await insertInspection(t, {
      orgId,
      userId,
      templateId,
      templateVersionId,
      status: "submitted",
      submittedAt,
    });

    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row!.submittedAt).toBe(submittedAt);
  });

  test("can store and retrieve completedBy (user id)", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId, templateId, templateVersionId } = await seedOrg(t);

    const id = await insertInspection(t, {
      orgId,
      userId,
      templateId,
      templateVersionId,
      status: "completed",
      completedBy: userId,
    });

    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row!.completedBy).toBe(userId);
  });

  test("can store and retrieve signOffs array", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId, templateId, templateVersionId } = await seedOrg(t);
    const now = Date.now();

    const id = await insertInspection(t, {
      orgId,
      userId,
      templateId,
      templateVersionId,
      status: "completed",
      signOffs: [
        { userId, role: "inspector", at: now },
      ],
    });

    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(Array.isArray(row!.signOffs)).toBe(true);
    expect((row!.signOffs as unknown[]).length).toBe(1);
    const entry = (row!.signOffs as Array<{ userId: string; role?: string; at: number }>)[0];
    expect(entry.userId).toBe(userId);
    expect(entry.role).toBe("inspector");
    expect(entry.at).toBe(now);
  });

  test("signOffs array is undefined when not set (field is optional)", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId, templateId, templateVersionId } = await seedOrg(t);

    const id = await insertInspection(t, {
      orgId,
      userId,
      templateId,
      templateVersionId,
      status: "in_progress",
    });

    const row = await t.run(async (ctx) => ctx.db.get(id));
    // Optional field — should be absent or undefined, never throwing
    expect(row).not.toBeNull();
    // Either undefined or an empty array is acceptable (schema declares optional)
    const signOffs = (row as Record<string, unknown>).signOffs;
    expect(signOffs == null || Array.isArray(signOffs)).toBe(true);
  });
});

// ===========================================================================
// SECTION 3: inspections.signOn — appends to signOffs
// ===========================================================================

describe("inspections.signOn — happy path", () => {
  test("appends a sign-off entry to an inspection with no prior signOffs", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId, templateId, templateVersionId } = await seedOrg(t);

    const inspectionId = await insertInspection(t, {
      orgId,
      userId,
      templateId,
      templateVersionId,
      status: "in_progress",
    });

    await t.mutation(api.inspections.signOn, {
      inspectionId,
      userId,
    });

    const row = await t.run(async (ctx) => ctx.db.get(inspectionId));
    expect(row).not.toBeNull();
    const signOffs = (row as Record<string, unknown>).signOffs as Array<{ userId: string; at: number }>;
    expect(Array.isArray(signOffs)).toBe(true);
    expect(signOffs.length).toBe(1);
    expect(signOffs[0].userId).toBe(userId);
    expect(typeof signOffs[0].at).toBe("number");
  });

  test("signOn sets the 'at' timestamp to a recent epoch ms value", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId, templateId, templateVersionId } = await seedOrg(t);

    const before = Date.now();
    const inspectionId = await insertInspection(t, {
      orgId,
      userId,
      templateId,
      templateVersionId,
      status: "in_progress",
    });

    await t.mutation(api.inspections.signOn, { inspectionId, userId });

    const after = Date.now();
    const row = await t.run(async (ctx) => ctx.db.get(inspectionId));
    const signOffs = (row as Record<string, unknown>).signOffs as Array<{ userId: string; at: number }>;
    expect(signOffs[0].at).toBeGreaterThanOrEqual(before);
    expect(signOffs[0].at).toBeLessThanOrEqual(after);
  });

  test("signOn stores role when provided", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId, templateId, templateVersionId } = await seedOrg(t);

    const inspectionId = await insertInspection(t, {
      orgId,
      userId,
      templateId,
      templateVersionId,
      status: "in_progress",
    });

    await t.mutation(api.inspections.signOn, {
      inspectionId,
      userId,
      role: "site_manager",
    });

    const row = await t.run(async (ctx) => ctx.db.get(inspectionId));
    const signOffs = (row as Record<string, unknown>).signOffs as Array<{ userId: string; role?: string; at: number }>;
    expect(signOffs[0].role).toBe("site_manager");
  });

  test("signOn without role stores entry without role field (or role is undefined)", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId, templateId, templateVersionId } = await seedOrg(t);

    const inspectionId = await insertInspection(t, {
      orgId,
      userId,
      templateId,
      templateVersionId,
      status: "in_progress",
    });

    await t.mutation(api.inspections.signOn, { inspectionId, userId });

    const row = await t.run(async (ctx) => ctx.db.get(inspectionId));
    const signOffs = (row as Record<string, unknown>).signOffs as Array<{ userId: string; role?: string; at: number }>;
    expect(signOffs.length).toBe(1);
    // role is optional — undefined is fine
    expect(signOffs[0].role == null).toBe(true);
  });

  test("signOn appends to existing signOffs (does not overwrite)", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId, templateId, templateVersionId } = await seedOrg(t);

    // Create a second user for dual sign-off
    const userId2 = await t.run(async (ctx) =>
      ctx.db.insert("users", { orgId, name: "Second Signer", authMethod: "email" }),
    );

    const inspectionId = await insertInspection(t, {
      orgId,
      userId,
      templateId,
      templateVersionId,
      status: "in_progress",
      signOffs: [{ userId, role: "inspector", at: Date.now() - 5000 }],
    });

    await t.mutation(api.inspections.signOn, {
      inspectionId,
      userId: userId2,
      role: "manager",
    });

    const row = await t.run(async (ctx) => ctx.db.get(inspectionId));
    const signOffs = (row as Record<string, unknown>).signOffs as Array<{ userId: string; role?: string; at: number }>;
    expect(signOffs.length).toBe(2);
    const userIds = signOffs.map((s) => s.userId);
    expect(userIds).toContain(userId);
    expect(userIds).toContain(userId2);
  });

  test("signOn returns { ok: true }", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId, templateId, templateVersionId } = await seedOrg(t);

    const inspectionId = await insertInspection(t, {
      orgId,
      userId,
      templateId,
      templateVersionId,
      status: "in_progress",
    });

    const result = await t.mutation(api.inspections.signOn, {
      inspectionId,
      userId,
    });

    expect(result).toEqual({ ok: true });
  });
});

describe("inspections.signOn — error handling", () => {
  test("throws when inspectionId does not exist", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId, templateId, templateVersionId } = await seedOrg(t);

    // Seed and delete an inspection to get a valid-typed but non-existent id
    const existingId = await insertInspection(t, {
      orgId,
      userId,
      templateId,
      templateVersionId,
      status: "in_progress",
    });
    // Use the real inspectionId type — just pass a non-existent one by using a real id string
    // convex-test will throw because the row doesn't exist (we verify the error path)
    await t.run(async (ctx) => ctx.db.delete(existingId));

    await expect(
      t.mutation(api.inspections.signOn, { inspectionId: existingId, userId }),
    ).rejects.toThrow();
  });
});

// ===========================================================================
// SECTION 4: inspections.closeIfResolved — sets closed/actions_open
// ===========================================================================

describe("inspections.closeIfResolved — all actions verified → closed", () => {
  test("sets status to 'closed' when all linked actions are 'verified'", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId, templateId, templateVersionId } = await seedOrg(t);

    const inspectionId = await insertInspection(t, {
      orgId,
      userId,
      templateId,
      templateVersionId,
      status: "actions_open",
    });

    await insertAction(t, { orgId, inspectionId, status: "verified", title: "Action 1" });
    await insertAction(t, { orgId, inspectionId, status: "verified", title: "Action 2" });

    const result = await t.mutation(api.inspections.closeIfResolved, { inspectionId });

    expect(result.status).toBe("closed");

    const row = await t.run(async (ctx) => ctx.db.get(inspectionId));
    expect(row!.status).toBe("closed");
  });

  test("sets status to 'closed' when there are NO linked actions at all", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId, templateId, templateVersionId } = await seedOrg(t);

    const inspectionId = await insertInspection(t, {
      orgId,
      userId,
      templateId,
      templateVersionId,
      status: "actions_open",
    });

    // No actions inserted — should still close
    const result = await t.mutation(api.inspections.closeIfResolved, { inspectionId });

    expect(result.status).toBe("closed");

    const row = await t.run(async (ctx) => ctx.db.get(inspectionId));
    expect(row!.status).toBe("closed");
  });
});

describe("inspections.closeIfResolved — mixed or unverified actions → actions_open", () => {
  test("sets status to 'actions_open' when at least one action is not 'verified'", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId, templateId, templateVersionId } = await seedOrg(t);

    const inspectionId = await insertInspection(t, {
      orgId,
      userId,
      templateId,
      templateVersionId,
      status: "completed",
    });

    await insertAction(t, { orgId, inspectionId, status: "verified", title: "Done action" });
    await insertAction(t, { orgId, inspectionId, status: "open", title: "Open action" });

    const result = await t.mutation(api.inspections.closeIfResolved, { inspectionId });

    expect(result.status).toBe("actions_open");

    const row = await t.run(async (ctx) => ctx.db.get(inspectionId));
    expect(row!.status).toBe("actions_open");
  });

  test("sets status to 'actions_open' when all actions are 'open' (none verified)", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId, templateId, templateVersionId } = await seedOrg(t);

    const inspectionId = await insertInspection(t, {
      orgId,
      userId,
      templateId,
      templateVersionId,
      status: "completed",
    });

    await insertAction(t, { orgId, inspectionId, status: "open", title: "Action A" });
    await insertAction(t, { orgId, inspectionId, status: "open", title: "Action B" });

    const result = await t.mutation(api.inspections.closeIfResolved, { inspectionId });

    expect(result.status).toBe("actions_open");
  });

  test("sets status to 'actions_open' when one action is 'in_progress' (not verified)", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId, templateId, templateVersionId } = await seedOrg(t);

    const inspectionId = await insertInspection(t, {
      orgId,
      userId,
      templateId,
      templateVersionId,
      status: "completed",
    });

    await insertAction(t, { orgId, inspectionId, status: "in_progress", title: "WIP action" });

    const result = await t.mutation(api.inspections.closeIfResolved, { inspectionId });

    expect(result.status).toBe("actions_open");
  });

  test("returns { status } object with the new status value", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId, templateId, templateVersionId } = await seedOrg(t);

    const inspectionId = await insertInspection(t, {
      orgId,
      userId,
      templateId,
      templateVersionId,
      status: "completed",
    });

    await insertAction(t, { orgId, inspectionId, status: "verified" });

    const result = await t.mutation(api.inspections.closeIfResolved, { inspectionId });

    // Must return an object with `status` field
    expect(typeof result).toBe("object");
    expect(result).toHaveProperty("status");
    expect(["closed", "actions_open"]).toContain(result.status);
  });
});

describe("inspections.closeIfResolved — org isolation", () => {
  test("only considers actions linked to the target inspection (not other inspections)", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId, templateId, templateVersionId } = await seedOrg(t);

    const insp1 = await insertInspection(t, {
      orgId,
      userId,
      templateId,
      templateVersionId,
      status: "completed",
    });

    const insp2 = await insertInspection(t, {
      orgId,
      userId,
      templateId,
      templateVersionId,
      status: "completed",
    });

    // insp1 has one verified action — should close
    await insertAction(t, { orgId, inspectionId: insp1, status: "verified" });
    // insp2 has one open action — unrelated to insp1
    await insertAction(t, { orgId, inspectionId: insp2, status: "open" });

    const result = await t.mutation(api.inspections.closeIfResolved, { inspectionId: insp1 });

    expect(result.status).toBe("closed");

    // insp2 is unaffected
    const row2 = await t.run(async (ctx) => ctx.db.get(insp2));
    expect(row2!.status).toBe("completed"); // unchanged
  });
});

describe("inspections.closeIfResolved — error handling", () => {
  test("throws when inspectionId does not exist", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId, templateId, templateVersionId } = await seedOrg(t);

    const existingId = await insertInspection(t, {
      orgId,
      userId,
      templateId,
      templateVersionId,
      status: "completed",
    });
    await t.run(async (ctx) => ctx.db.delete(existingId));

    await expect(
      t.mutation(api.inspections.closeIfResolved, { inspectionId: existingId }),
    ).rejects.toThrow();
  });
});

// ===========================================================================
// SECTION 5: Back-compat — existing statuses still accepted
// ===========================================================================

describe("back-compat: existing inspection statuses still valid after schema extension", () => {
  test("in_progress is still accepted", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId, templateId, templateVersionId } = await seedOrg(t);

    const id = await insertInspection(t, {
      orgId,
      userId,
      templateId,
      templateVersionId,
      status: "in_progress",
    });

    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row!.status).toBe("in_progress");
  });

  test("completed is still accepted", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId, templateId, templateVersionId } = await seedOrg(t);

    const id = await insertInspection(t, {
      orgId,
      userId,
      templateId,
      templateVersionId,
      status: "completed",
    });

    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row!.status).toBe("completed");
  });

  test("submitted is still accepted", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId, templateId, templateVersionId } = await seedOrg(t);

    const id = await insertInspection(t, {
      orgId,
      userId,
      templateId,
      templateVersionId,
      status: "submitted",
    });

    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row!.status).toBe("submitted");
  });
});

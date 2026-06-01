/**
 * Tests for corrective-action closed-loop (spec §5.4, DoD #11).
 *
 * Intended API (to be implemented / extended):
 *
 * convex/schema.ts — actions table extensions (all backward-compatible):
 *   - priority union: extend to include "critical" (keep low|medium|high)
 *   - status union: extend to include "open"|"in_progress"|"done"|"verified" (keep "todo")
 *   - NEW optional fields:
 *       assignedTo?: v.id("users")
 *       dueAt?: v.number()
 *       evidence?: v.array(v.object({ mediaId?: v.id("media"), note?: v.string() }))
 *       verifiedBy?: v.id("users")
 *       verifiedAt?: v.number()
 *   - NEW optional index: by_org_assignee on ["orgId","assignedTo"]
 *
 * convex/actions.ts — new / extended mutations & queries:
 *   - actions.update({ actionId, status?, assignedTo?, dueAt?, priority? })
 *       patches the named fields (only those provided)
 *   - actions.verify({ actionId, evidence })
 *       throws ConvexError (or Error) when evidence array is empty / absent
 *       sets status → "verified", verifiedAt → Date.now(), verifiedBy? (optional)
 *   - actions.listForOwner({ orgId, assignedTo? })
 *       returns all actions for orgId; if assignedTo is given, filters to that user
 *
 * convex-test safe: all tests use ctx.db CRUD + t.mutation/t.query only.
 * No component calls, no workflow.start, no inspections.complete.
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

async function seedOrg(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    return ctx.db.insert("organizations", {
      name: "Actions Test Org",
      slug: "actions-test-org",
      plan: "free",
    });
  });
}

async function seedUser(
  t: ReturnType<typeof convexTest>,
  orgId: string,
  name = "Test User",
) {
  return t.run(async (ctx) => {
    return ctx.db.insert("users", {
      orgId: orgId as Parameters<typeof ctx.db.insert>[1] extends { orgId: infer O } ? O : never,
      name,
      authMethod: "email",
    });
  });
}

/** Insert an action directly (bypasses the legacy create mutation so we can
 *  use the new "open" status that the implementer must add). */
async function insertAction(
  t: ReturnType<typeof convexTest>,
  fields: {
    orgId: string;
    title?: string;
    status?: string;
    priority?: string;
    assignedTo?: string;
    dueAt?: number;
  },
) {
  return t.run(async (ctx) => {
    return ctx.db.insert("actions", {
      orgId: fields.orgId as Parameters<typeof ctx.db.insert>[1] extends { orgId: infer O } ? O : never,
      title: fields.title ?? "Fix broken guardrail",
      status: (fields.status ?? "open") as "todo" | "in_progress" | "done",
      priority: (fields.priority ?? "medium") as "low" | "medium" | "high",
      source: "manual",
      ...(fields.assignedTo !== undefined && { assignedTo: fields.assignedTo as Parameters<typeof ctx.db.insert>[1] extends { assignedTo: infer A } ? A : never }),
      ...(fields.dueAt !== undefined && { dueAt: fields.dueAt }),
    } as Parameters<typeof ctx.db.insert<"actions">>[1]);
  });
}

// ---------------------------------------------------------------------------
// actions.update — status lifecycle
// ---------------------------------------------------------------------------

describe("actions.update — status transitions", () => {
  test("update status from open to in_progress", async () => {
    const t = convexTest(schema, modules);
    const orgId = await seedOrg(t);
    const actionId = await insertAction(t, { orgId, status: "open" });

    await t.mutation(api.actions.update, {
      actionId,
      status: "in_progress",
    });

    const row = await t.run(async (ctx) => ctx.db.get(actionId));
    expect(row).not.toBeNull();
    expect(row!.status).toBe("in_progress");
  });

  test("update status from in_progress to done", async () => {
    const t = convexTest(schema, modules);
    const orgId = await seedOrg(t);
    const actionId = await insertAction(t, { orgId, status: "in_progress" });

    await t.mutation(api.actions.update, {
      actionId,
      status: "done",
    });

    const row = await t.run(async (ctx) => ctx.db.get(actionId));
    expect(row!.status).toBe("done");
  });

  test("update preserves unrelated fields when only status is given", async () => {
    const t = convexTest(schema, modules);
    const orgId = await seedOrg(t);
    const actionId = await insertAction(t, {
      orgId,
      title: "My action",
      status: "open",
      priority: "high",
    });

    await t.mutation(api.actions.update, { actionId, status: "in_progress" });

    const row = await t.run(async (ctx) => ctx.db.get(actionId));
    expect(row!.title).toBe("My action");
    expect(row!.priority).toBe("high");
  });
});

// ---------------------------------------------------------------------------
// actions.update — assignedTo + dueAt + priority
// ---------------------------------------------------------------------------

describe("actions.update — optional fields", () => {
  test("update sets assignedTo on an existing action", async () => {
    const t = convexTest(schema, modules);
    const orgId = await seedOrg(t);
    const userId = await seedUser(t, orgId, "Assignee");
    const actionId = await insertAction(t, { orgId });

    await t.mutation(api.actions.update, {
      actionId,
      assignedTo: userId,
    });

    const row = await t.run(async (ctx) => ctx.db.get(actionId));
    expect(row!.assignedTo).toBe(userId);
  });

  test("update sets dueAt timestamp", async () => {
    const t = convexTest(schema, modules);
    const orgId = await seedOrg(t);
    const actionId = await insertAction(t, { orgId });
    const dueAt = Date.now() + 7 * 24 * 60 * 60 * 1000;

    await t.mutation(api.actions.update, { actionId, dueAt });

    const row = await t.run(async (ctx) => ctx.db.get(actionId));
    expect(row!.dueAt).toBe(dueAt);
  });

  test("update raises priority to critical (new union member)", async () => {
    const t = convexTest(schema, modules);
    const orgId = await seedOrg(t);
    const actionId = await insertAction(t, { orgId, priority: "medium" });

    await t.mutation(api.actions.update, { actionId, priority: "critical" });

    const row = await t.run(async (ctx) => ctx.db.get(actionId));
    expect(row!.priority).toBe("critical");
  });

  test("update can change multiple fields at once", async () => {
    const t = convexTest(schema, modules);
    const orgId = await seedOrg(t);
    const userId = await seedUser(t, orgId);
    const actionId = await insertAction(t, { orgId, status: "open" });
    const dueAt = Date.now() + 3 * 24 * 60 * 60 * 1000;

    await t.mutation(api.actions.update, {
      actionId,
      status: "in_progress",
      assignedTo: userId,
      dueAt,
      priority: "high",
    });

    const row = await t.run(async (ctx) => ctx.db.get(actionId));
    expect(row!.status).toBe("in_progress");
    expect(row!.assignedTo).toBe(userId);
    expect(row!.dueAt).toBe(dueAt);
    expect(row!.priority).toBe("high");
  });
});

// ---------------------------------------------------------------------------
// actions.verify — evidence required
// ---------------------------------------------------------------------------

describe("actions.verify — evidence guard", () => {
  test("verify() without evidence throws an error", async () => {
    const t = convexTest(schema, modules);
    const orgId = await seedOrg(t);
    const actionId = await insertAction(t, { orgId, status: "done" });

    await expect(
      t.mutation(api.actions.verify, {
        actionId,
        evidence: [],
      }),
    ).rejects.toThrow();
  });

  test("verify() with a text-note evidence item sets status to verified", async () => {
    const t = convexTest(schema, modules);
    const orgId = await seedOrg(t);
    const actionId = await insertAction(t, { orgId, status: "done" });

    await t.mutation(api.actions.verify, {
      actionId,
      evidence: [{ note: "Guardrail replaced and inspected." }],
    });

    const row = await t.run(async (ctx) => ctx.db.get(actionId));
    expect(row).not.toBeNull();
    expect(row!.status).toBe("verified");
  });

  test("verify() sets verifiedAt to a recent timestamp", async () => {
    const t = convexTest(schema, modules);
    const orgId = await seedOrg(t);
    const actionId = await insertAction(t, { orgId, status: "done" });
    const before = Date.now();

    await t.mutation(api.actions.verify, {
      actionId,
      evidence: [{ note: "Verification complete" }],
    });

    const after = Date.now();
    const row = await t.run(async (ctx) => ctx.db.get(actionId));
    expect(typeof row!.verifiedAt).toBe("number");
    expect(row!.verifiedAt).toBeGreaterThanOrEqual(before);
    expect(row!.verifiedAt).toBeLessThanOrEqual(after);
  });

  test("verify() stores the evidence array on the row", async () => {
    const t = convexTest(schema, modules);
    const orgId = await seedOrg(t);
    const actionId = await insertAction(t, { orgId, status: "done" });

    await t.mutation(api.actions.verify, {
      actionId,
      evidence: [
        { note: "Photo taken" },
        { note: "Secondary check passed" },
      ],
    });

    const row = await t.run(async (ctx) => ctx.db.get(actionId));
    expect(Array.isArray(row!.evidence)).toBe(true);
    expect((row!.evidence as unknown[]).length).toBe(2);
  });

  test("verify() with only a note-based evidence item, status becomes verified", async () => {
    // Tests that verify() accepts a single evidence item with note only (no mediaId).
    // The media-id path is covered by schema — once the schema accepts v.id("media") in
    // evidence items, any valid media id can be passed. This test exercises the note-only
    // path which avoids needing a real _storage record in the test harness.
    const t = convexTest(schema, modules);
    const orgId = await seedOrg(t);
    const actionId = await insertAction(t, { orgId, status: "done" });

    await t.mutation(api.actions.verify, {
      actionId,
      evidence: [{ note: "Corrective work photographed and filed." }],
    });

    const row = await t.run(async (ctx) => ctx.db.get(actionId));
    expect(row!.status).toBe("verified");
    // verifiedAt should be set
    expect(typeof row!.verifiedAt).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// actions.listForOwner
// ---------------------------------------------------------------------------

describe("actions.listForOwner", () => {
  test("returns all actions for the org when assignedTo is omitted", async () => {
    const t = convexTest(schema, modules);
    const orgId = await seedOrg(t);
    const userA = await seedUser(t, orgId, "User A");
    const userB = await seedUser(t, orgId, "User B");

    await insertAction(t, { orgId, title: "Action 1", assignedTo: userA });
    await insertAction(t, { orgId, title: "Action 2", assignedTo: userB });
    await insertAction(t, { orgId, title: "Action 3" }); // no assignee

    const results = await t.query(api.actions.listForOwner, { orgId });

    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(3);
  });

  test("filters to only the given assignedTo when provided", async () => {
    const t = convexTest(schema, modules);
    const orgId = await seedOrg(t);
    const userA = await seedUser(t, orgId, "User A");
    const userB = await seedUser(t, orgId, "User B");

    await insertAction(t, { orgId, title: "User A Action", assignedTo: userA });
    await insertAction(t, { orgId, title: "User B Action", assignedTo: userB });

    const results = await t.query(api.actions.listForOwner, {
      orgId,
      assignedTo: userA,
    });

    expect(results.length).toBe(1);
    expect(results[0].title).toBe("User A Action");
  });

  test("returns empty array when no actions match assignedTo", async () => {
    const t = convexTest(schema, modules);
    const orgId = await seedOrg(t);
    const userA = await seedUser(t, orgId, "User A");
    const userB = await seedUser(t, orgId, "User B");

    await insertAction(t, { orgId, assignedTo: userB });

    const results = await t.query(api.actions.listForOwner, {
      orgId,
      assignedTo: userA,
    });

    expect(results).toEqual([]);
  });

  test("does not return actions from a different org", async () => {
    const t = convexTest(schema, modules);
    const orgA = await seedOrg(t);
    const orgB = await t.run(async (ctx) =>
      ctx.db.insert("organizations", {
        name: "Other Org",
        slug: "other-org-actions",
        plan: "free",
      }),
    );

    await insertAction(t, { orgId: orgA, title: "Org A action" });
    await insertAction(t, { orgId: orgB, title: "Org B action" });

    const results = await t.query(api.actions.listForOwner, { orgId: orgB });

    expect(results.length).toBe(1);
    expect(results[0].title).toBe("Org B action");
  });

  test("returns verified actions too (not just open/in_progress)", async () => {
    const t = convexTest(schema, modules);
    const orgId = await seedOrg(t);
    const userId = await seedUser(t, orgId);

    await insertAction(t, { orgId, status: "open", assignedTo: userId });
    await insertAction(t, { orgId, status: "verified", assignedTo: userId });

    const results = await t.query(api.actions.listForOwner, {
      orgId,
      assignedTo: userId,
    });

    expect(results.length).toBe(2);
    const statuses = results.map((r: { status: string }) => r.status);
    expect(statuses).toContain("open");
    expect(statuses).toContain("verified");
  });
});

// ---------------------------------------------------------------------------
// Schema back-compat: "todo" status still accepted
// ---------------------------------------------------------------------------

describe("backward-compat: legacy status 'todo' still valid", () => {
  test("an action with status 'todo' can be inserted directly (schema still accepts it)", async () => {
    const t = convexTest(schema, modules);
    const orgId = await seedOrg(t);

    // Direct insert using legacy status — must NOT throw a schema validation error.
    const id = await t.run(async (ctx) =>
      ctx.db.insert("actions", {
        orgId: orgId as Parameters<typeof ctx.db.insert<"actions">>[1] extends { orgId: infer O } ? O : never,
        title: "Legacy todo action",
        status: "todo" as Parameters<typeof ctx.db.insert<"actions">>[1] extends { status: infer S } ? S : never,
        priority: "medium" as Parameters<typeof ctx.db.insert<"actions">>[1] extends { priority: infer P } ? P : never,
        source: "manual",
      } as Parameters<typeof ctx.db.insert<"actions">>[1]),
    );

    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row!.status).toBe("todo");
  });

  test("actions.update can set status to 'todo' (legacy value, back-compat)", async () => {
    const t = convexTest(schema, modules);
    const orgId = await seedOrg(t);
    const actionId = await insertAction(t, { orgId, status: "open" });

    // Should not throw — "todo" must remain in the status union.
    await t.mutation(api.actions.update, {
      actionId,
      status: "todo",
    });

    const row = await t.run(async (ctx) => ctx.db.get(actionId));
    expect(row!.status).toBe("todo");
  });
});

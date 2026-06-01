/**
 * Tests for contracts.listByOrg and contracts.create (spec §jobs/contracts, DoD Phase 1).
 *
 * Intended API (to be implemented):
 *  - convex/contracts.ts: `contracts.create({ orgId, name, status? })` → id
 *  - convex/contracts.ts: `contracts.listByOrg({ orgId })` → Contract[]
 *      ordered by _creationTime ascending (insertion order)
 *      filters strictly to the given orgId — no cross-org leakage
 *
 * convex-test safe: all tests use pure ctx.db CRUD — no component calls, no workflow.start.
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

async function seedOrg(
  t: ReturnType<typeof convexTest>,
  name: string,
): Promise<{ orgId: string }> {
  return t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      name,
      slug: name.toLowerCase().replace(/\s+/g, "-"),
      plan: "free",
    });
    return { orgId };
  });
}

// ---------------------------------------------------------------------------
// contracts.create
// ---------------------------------------------------------------------------

describe("contracts.create", () => {
  test("creates a contract and returns a string id", async () => {
    const t = convexTest(schema, modules);
    const { orgId } = await seedOrg(t, "Create Test Org");

    const contractId = await t.mutation(api.contracts.create, {
      orgId,
      name: "Alpha Contract",
    });

    expect(typeof contractId).toBe("string");
    expect(contractId.length).toBeGreaterThan(0);
  });

  test("persisted row has correct orgId and name", async () => {
    const t = convexTest(schema, modules);
    const { orgId } = await seedOrg(t, "Persist Test Org");

    const contractId = await t.mutation(api.contracts.create, {
      orgId,
      name: "Beta Contract",
    });

    const row = await t.run(async (ctx) => ctx.db.get(contractId));

    expect(row).not.toBeNull();
    expect(row!.orgId).toBe(orgId);
    expect(row!.name).toBe("Beta Contract");
  });

  test("stores optional status when provided", async () => {
    const t = convexTest(schema, modules);
    const { orgId } = await seedOrg(t, "Status Test Org");

    const contractId = await t.mutation(api.contracts.create, {
      orgId,
      name: "Active Contract",
      status: "active",
    });

    const row = await t.run(async (ctx) => ctx.db.get(contractId));

    expect(row).not.toBeNull();
    expect(row!.status).toBe("active");
  });

  test("status is absent when not supplied", async () => {
    const t = convexTest(schema, modules);
    const { orgId } = await seedOrg(t, "No-Status Org");

    const contractId = await t.mutation(api.contracts.create, {
      orgId,
      name: "No-Status Contract",
    });

    const row = await t.run(async (ctx) => ctx.db.get(contractId));

    expect(row).not.toBeNull();
    expect(row!.status).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// contracts.listByOrg
// ---------------------------------------------------------------------------

describe("contracts.listByOrg", () => {
  test("returns only this org's contracts and excludes another org's", async () => {
    const t = convexTest(schema, modules);
    const { orgId: orgA } = await seedOrg(t, "Org A");
    const { orgId: orgB } = await seedOrg(t, "Org B");

    // Two contracts for org A.
    await t.mutation(api.contracts.create, { orgId: orgA, name: "Contract A1" });
    await t.mutation(api.contracts.create, { orgId: orgA, name: "Contract A2" });
    // One contract for org B (should not appear in org A results).
    await t.mutation(api.contracts.create, { orgId: orgB, name: "Contract B1" });

    const results = await t.query(api.contracts.listByOrg, { orgId: orgA });

    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(2);
    const names = results.map((c: { name: string }) => c.name);
    expect(names).toContain("Contract A1");
    expect(names).toContain("Contract A2");
    expect(names).not.toContain("Contract B1");
  });

  test("returns empty array when org has no contracts", async () => {
    const t = convexTest(schema, modules);
    const { orgId } = await seedOrg(t, "Empty Org");

    const results = await t.query(api.contracts.listByOrg, { orgId });

    expect(results).toEqual([]);
  });

  test("returns contracts in insertion order (ascending _creationTime)", async () => {
    const t = convexTest(schema, modules);
    const { orgId } = await seedOrg(t, "Order Test Org");

    const id1 = await t.mutation(api.contracts.create, {
      orgId,
      name: "First Contract",
    });
    const id2 = await t.mutation(api.contracts.create, {
      orgId,
      name: "Second Contract",
    });
    const id3 = await t.mutation(api.contracts.create, {
      orgId,
      name: "Third Contract",
    });

    const results = await t.query(api.contracts.listByOrg, { orgId });

    expect(results.length).toBe(3);
    const ids = results.map((c: { _id: string }) => c._id);
    expect(ids[0]).toBe(id1);
    expect(ids[1]).toBe(id2);
    expect(ids[2]).toBe(id3);
  });

  test("each returned row includes orgId, name, and optional status", async () => {
    const t = convexTest(schema, modules);
    const { orgId } = await seedOrg(t, "Fields Test Org");

    await t.mutation(api.contracts.create, {
      orgId,
      name: "Full Contract",
      status: "draft",
    });

    const [row] = await t.query(api.contracts.listByOrg, { orgId });

    expect(row).toMatchObject({
      orgId,
      name: "Full Contract",
      status: "draft",
    });
    expect(typeof row._id).toBe("string");
    expect(typeof row._creationTime).toBe("number");
  });

  test("org B's listByOrg is unaffected by org A contracts", async () => {
    const t = convexTest(schema, modules);
    const { orgId: orgA } = await seedOrg(t, "Cross-Org A");
    const { orgId: orgB } = await seedOrg(t, "Cross-Org B");

    // Seed org A with two contracts.
    await t.mutation(api.contracts.create, { orgId: orgA, name: "A-Only 1" });
    await t.mutation(api.contracts.create, { orgId: orgA, name: "A-Only 2" });

    // Org B should still have zero contracts.
    const resultsB = await t.query(api.contracts.listByOrg, { orgId: orgB });
    expect(resultsB).toEqual([]);
  });
});

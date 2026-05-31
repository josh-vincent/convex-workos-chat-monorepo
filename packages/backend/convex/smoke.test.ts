/**
 * Smoke test for the Convex test harness.
 *
 * Constraints (see CLAUDE.md hard constraints):
 *  - ONLY tests simple ctx.db reads/writes — no component calls.
 *  - Does NOT call inspections.complete, workflows, action-retrier, or aggregate.
 *  - Excludes "use node" files (reports.tsx) and the component-wiring file
 *    (components.ts) from the glob so convex-test can safely collect modules.
 */
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";

// Scope the glob to standard convex function files, explicitly excluding:
//  - reports.tsx  ("use node" — Node.js-only, incompatible with edge-runtime)
//  - components.ts (instantiates @convex-dev/aggregate / workflow / action-retrier)
//  - workflows.ts  (references components.ts + workflow.define)
// NOTE: _generated/* MUST be included — convex-test uses it to locate the module root.
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

test("insert an organization and read it back", async () => {
  const t = convexTest(schema, modules);

  const orgId = await t.run(async (ctx) => {
    return await ctx.db.insert("organizations", {
      name: "Acme Corp",
      slug: "acme",
      plan: "free",
    });
  });

  const org = await t.run(async (ctx) => {
    return await ctx.db.get(orgId);
  });

  expect(org).not.toBeNull();
  expect(org!.name).toBe("Acme Corp");
  expect(org!.slug).toBe("acme");
  expect(org!.plan).toBe("free");
});

test("query organizations by slug index", async () => {
  const t = convexTest(schema, modules);

  await t.run(async (ctx) => {
    await ctx.db.insert("organizations", {
      name: "Beacon Safety",
      slug: "beacon",
      plan: "team",
    });
  });

  const found = await t.run(async (ctx) => {
    return await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", "beacon"))
      .unique();
  });

  expect(found).not.toBeNull();
  expect(found!.name).toBe("Beacon Safety");
});

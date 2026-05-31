// Seed a demo org with sites, users, assets, a sensor, and EVERY vertical template pack
// PLUS the 100 imported real-world SafetyCulture library templates. Idempotent.
//
//   npx convex run seed:seedAll       # demo org + curated packs + library
//   npx convex run seed:seedLibrary   # (re)load just the library into the demo org
import { internalMutation, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { packs } from "./templatePacks";
import type { TemplateDef } from "./templatePacks/types";
import { libraryTemplates } from "./libraryTemplates/library.generated";

const LIBRARY_PACK_KEY = "safetyculture-library";

/** Insert a batch of template definitions as published, versioned templates. */
async function insertTemplates(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
  packKey: string,
  defs: TemplateDef[],
  changeNote: string,
) {
  let count = 0;
  for (const t of defs) {
    const templateId = await ctx.db.insert("templates", {
      orgId,
      key: t.key,
      name: t.name,
      category: t.category,
      industry: t.industry,
      description: t.description,
      packKey,
      currentVersion: 1,
      status: "published",
      source: t.source ?? "pack",
      author: t.author,
      sourceUrl: t.sourceUrl,
      downloads: t.downloads,
      fieldCount: t.fieldCount,
    });
    await ctx.db.insert("templateVersions", {
      templateId,
      version: 1,
      sections: t.sections,
      scoringEnabled: t.scoringEnabled ?? true,
      changeNote,
    });
    count++;
  }
  return count;
}

export const seedAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", "northwind"))
      .unique();
    if (existing) return { skipped: true, orgId: existing._id };

    const orgId = await ctx.db.insert("organizations", {
      name: "Northwind Ops",
      slug: "northwind",
      plan: "business",
      dataRetentionYears: 5,
    });

    // Region › site hierarchy
    const national = await ctx.db.insert("sites", { orgId, name: "Northwind (All Sites)", region: "National" });
    const warehouse = await ctx.db.insert("sites", {
      orgId, name: "Denver Warehouse", code: "DEN", parentSiteId: national, region: "West", lat: 39.74, lng: -104.99,
    });
    await ctx.db.insert("sites", { orgId, name: "Portland Plant", code: "PDX", parentSiteId: national, region: "West" });

    // Users — note the kiosk user on a shared device (PIN auth), no per-seat tax.
    const admin = await ctx.db.insert("users", { orgId, name: "Josh Miller", email: "josh@northwind.example", authMethod: "sso" });
    const inspector = await ctx.db.insert("users", { orgId, name: "Maria Lopez", email: "maria@northwind.example", authMethod: "email" });
    const kiosk = await ctx.db.insert("users", { orgId, name: "Shop Floor Kiosk 1", authMethod: "pin" });
    await ctx.db.insert("memberships", { orgId, userId: admin, role: "admin" });
    await ctx.db.insert("memberships", { orgId, userId: inspector, role: "inspector" });
    await ctx.db.insert("memberships", { orgId, userId: kiosk, role: "contributor" });

    // Assets + a cold-store temperature sensor
    await ctx.db.insert("assets", { orgId, siteId: warehouse, name: "Forklift FL-07", type: "forklift", qrCode: "BCN-FL-07", status: "operational" });
    const fridge = await ctx.db.insert("assets", { orgId, siteId: warehouse, name: "Cold Store CS-2", type: "fridge", qrCode: "BCN-CS-2", status: "operational" });
    await ctx.db.insert("sensors", {
      orgId, assetId: fridge, name: "CS-2 Temperature", kind: "temperature", unit: "°C",
      thresholdMin: 1, thresholdMax: 5, lastValue: 3.4, lastReadingAt: Date.now(),
    });

    // Curated vertical packs.
    let templateCount = 0;
    for (const pack of packs) {
      templateCount += await insertTemplates(ctx, orgId, pack.key, pack.templates, "Seeded from template pack");
    }

    // The full imported SafetyCulture library (100 real templates).
    const libraryCount = await insertTemplates(
      ctx, orgId, LIBRARY_PACK_KEY, libraryTemplates, "Imported from SafetyCulture library",
    );

    // A demo action so the dashboard isn't empty.
    await ctx.db.insert("actions", {
      orgId, siteId: warehouse, title: "Replace damaged pallet racking — Aisle 4",
      priority: "high", status: "todo", source: "issue",
    });

    return { orgId, sites: 3, packs: packs.length, templateCount, libraryCount };
  },
});

/** (Re)load just the imported library into the existing demo org. Idempotent. */
export const seedLibrary = internalMutation({
  args: {},
  handler: async (ctx) => {
    const org = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", "northwind"))
      .unique();
    if (!org) return { error: "Run seed:seedAll first to create the demo org." };

    const already = await ctx.db
      .query("templates")
      .withIndex("by_pack", (q) => q.eq("packKey", LIBRARY_PACK_KEY))
      .first();
    if (already) return { skipped: true, reason: "Library already seeded." };

    const libraryCount = await insertTemplates(
      ctx, org._id, LIBRARY_PACK_KEY, libraryTemplates, "Imported from SafetyCulture library",
    );
    return { orgId: org._id, libraryCount };
  },
});

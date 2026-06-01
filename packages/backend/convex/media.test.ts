/**
 * Tests for tamper-evident evidence metadata on media (spec §5.5, §10, DoD #3).
 *
 * Intended API (to be implemented):
 *
 *  convex/schema.ts — additive/backward-compatible additions on the `media` table:
 *    capturedAt:   v.optional(v.number())          — epoch ms when photo/video was taken
 *    capturedBy:   v.optional(v.id("users"))       — user who captured the evidence
 *    geo:          v.optional(v.object({ lat: v.number(), lng: v.number(), accuracy: v.optional(v.number()) }))
 *    contentHash:  v.optional(v.string())          — e.g. SHA-256 hex of the file bytes
 *
 *  convex/media.ts — `media.record` mutation:
 *    Accept the four new optional fields (capturedAt, capturedBy, geo, contentHash)
 *    in addition to the existing orgId / storageId / kind / name args.
 *    Persist all four to the `media` row when provided.
 *
 *  convex/media.ts — `media.urls` query:
 *    In addition to the existing { mediaId, url, kind, name } fields, also return:
 *      capturedAt:  number | undefined
 *      geo:         { lat, lng, accuracy? } | undefined
 *      contentHash: string | undefined
 *    so the office UI can display provenance alongside the image.
 *
 * convex-test safe:
 *  - record/urls tests only use ctx.db reads/writes (storage.getUrl may return null in tests).
 *  - No component calls, no workflow.start, no scoreByOrg/scoreBySite.
 *  - Use t.withIdentity for auth; assert on stored DB fields, NOT on the URL string.
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

/** Seed the minimum rows required to exercise media.record. */
async function seedPrerequisites(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      name: "Media Provenance Org",
      slug: "media-provenance-org",
      plan: "free",
    });

    const userId = await ctx.db.insert("users", {
      orgId,
      name: "Field Inspector",
      authMethod: "email",
    });

    return { orgId, userId };
  });
}

/**
 * Use ctx.storage.store() inside t.run() — convex-test exposes the action-level
 * StorageActionWriter (with store()) through the run() handler context so we can
 * store a tiny Blob and get back a proper v.id("_storage") without touching
 * the system table directly (which is read-only through ctx.db).
 */
async function seedStorageId(t: ReturnType<typeof convexTest>): Promise<string> {
  return t.run(async (ctx) => {
    const blob = new Blob(["test"], { type: "image/png" });
    return (ctx as any).storage.store(blob);
  });
}

// ---------------------------------------------------------------------------
// media.record — new provenance fields stored in DB
// ---------------------------------------------------------------------------

describe("media.record — tamper-evident metadata stored", () => {
  test("capturedAt is persisted when provided", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId } = await seedPrerequisites(t);
    const storageId = await seedStorageId(t);

    const capturedAt = new Date("2026-03-15T09:30:00.000Z").getTime();

    const result = await t.withIdentity({ subject: userId }).mutation(
      api.media.record,
      {
        orgId,
        storageId: storageId as any,
        kind: "photo",
        capturedAt,
      },
    );

    const row = await t.run(async (ctx) => ctx.db.get(result.mediaId));
    expect(row).not.toBeNull();
    expect(row!.capturedAt).toBe(capturedAt);
  });

  test("capturedBy (userId) is persisted when provided", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId } = await seedPrerequisites(t);
    const storageId = await seedStorageId(t);

    const result = await t.withIdentity({ subject: userId }).mutation(
      api.media.record,
      {
        orgId,
        storageId: storageId as any,
        kind: "photo",
        capturedBy: userId,
      },
    );

    const row = await t.run(async (ctx) => ctx.db.get(result.mediaId));
    expect(row).not.toBeNull();
    expect(row!.capturedBy).toBe(userId);
  });

  test("geo (lat/lng) is persisted when provided", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId } = await seedPrerequisites(t);
    const storageId = await seedStorageId(t);

    const geo = { lat: -37.8136, lng: 144.9631 };

    const result = await t.withIdentity({ subject: userId }).mutation(
      api.media.record,
      {
        orgId,
        storageId: storageId as any,
        kind: "photo",
        geo,
      },
    );

    const row = await t.run(async (ctx) => ctx.db.get(result.mediaId));
    expect(row).not.toBeNull();
    expect(row!.geo).toBeDefined();
    expect(row!.geo!.lat).toBeCloseTo(-37.8136);
    expect(row!.geo!.lng).toBeCloseTo(144.9631);
  });

  test("geo with accuracy is persisted when provided", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId } = await seedPrerequisites(t);
    const storageId = await seedStorageId(t);

    const geo = { lat: -33.8688, lng: 151.2093, accuracy: 5.2 };

    const result = await t.withIdentity({ subject: userId }).mutation(
      api.media.record,
      {
        orgId,
        storageId: storageId as any,
        kind: "photo",
        geo,
      },
    );

    const row = await t.run(async (ctx) => ctx.db.get(result.mediaId));
    expect(row).not.toBeNull();
    expect(row!.geo!.accuracy).toBeCloseTo(5.2);
  });

  test("contentHash is persisted when provided", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId } = await seedPrerequisites(t);
    const storageId = await seedStorageId(t);

    const contentHash =
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

    const result = await t.withIdentity({ subject: userId }).mutation(
      api.media.record,
      {
        orgId,
        storageId: storageId as any,
        kind: "photo",
        contentHash,
      },
    );

    const row = await t.run(async (ctx) => ctx.db.get(result.mediaId));
    expect(row).not.toBeNull();
    expect(row!.contentHash).toBe(contentHash);
  });

  test("all four provenance fields are persisted together", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId } = await seedPrerequisites(t);
    const storageId = await seedStorageId(t);

    const capturedAt = new Date("2026-03-15T09:30:00.000Z").getTime();
    const geo = { lat: -37.8136, lng: 144.9631, accuracy: 3.0 };
    const contentHash =
      "abc123def456abc123def456abc123def456abc123def456abc123def456abc1";

    const result = await t.withIdentity({ subject: userId }).mutation(
      api.media.record,
      {
        orgId,
        storageId: storageId as any,
        kind: "photo",
        name: "site-photo.jpg",
        capturedAt,
        capturedBy: userId,
        geo,
        contentHash,
      },
    );

    const row = await t.run(async (ctx) => ctx.db.get(result.mediaId));
    expect(row).not.toBeNull();
    expect(row!.capturedAt).toBe(capturedAt);
    expect(row!.capturedBy).toBe(userId);
    expect(row!.geo!.lat).toBeCloseTo(-37.8136);
    expect(row!.geo!.lng).toBeCloseTo(144.9631);
    expect(row!.geo!.accuracy).toBeCloseTo(3.0);
    expect(row!.contentHash).toBe(contentHash);
  });

  test("record without provenance fields leaves them undefined (backward-compatible)", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId } = await seedPrerequisites(t);
    const storageId = await seedStorageId(t);

    const result = await t.withIdentity({ subject: userId }).mutation(
      api.media.record,
      {
        orgId,
        storageId: storageId as any,
        kind: "photo",
        name: "legacy-photo.jpg",
        // No capturedAt, capturedBy, geo, contentHash
      },
    );

    const row = await t.run(async (ctx) => ctx.db.get(result.mediaId));
    expect(row).not.toBeNull();
    // New fields must be absent on old-style records (backward-compat).
    expect(row!.capturedAt).toBeUndefined();
    expect((row as any).capturedBy).toBeUndefined();
    expect(row!.geo).toBeUndefined();
    expect(row!.contentHash).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// media.urls — provenance fields returned alongside existing fields
// ---------------------------------------------------------------------------

describe("media.urls — provenance metadata returned", () => {
  test("urls returns capturedAt when stored on the media row", async () => {
    const t = convexTest(schema, modules);
    const { orgId } = await seedPrerequisites(t);
    const storageId = await seedStorageId(t);

    const capturedAt = new Date("2026-04-01T12:00:00.000Z").getTime();

    const mediaId = await t.run(async (ctx) => {
      return ctx.db.insert("media", {
        orgId,
        storageId: storageId as any,
        kind: "photo",
        capturedAt,
      });
    });

    const results = await t.query(api.media.urls, { ids: [mediaId] });
    expect(results.length).toBe(1);
    expect(results[0].capturedAt).toBe(capturedAt);
  });

  test("urls returns geo when stored on the media row", async () => {
    const t = convexTest(schema, modules);
    const { orgId } = await seedPrerequisites(t);
    const storageId = await seedStorageId(t);

    const geo = { lat: -27.4698, lng: 153.0251, accuracy: 8.5 };

    const mediaId = await t.run(async (ctx) => {
      return ctx.db.insert("media", {
        orgId,
        storageId: storageId as any,
        kind: "photo",
        geo,
      });
    });

    const results = await t.query(api.media.urls, { ids: [mediaId] });
    expect(results.length).toBe(1);
    expect(results[0].geo).toBeDefined();
    expect(results[0].geo!.lat).toBeCloseTo(-27.4698);
    expect(results[0].geo!.lng).toBeCloseTo(153.0251);
    expect(results[0].geo!.accuracy).toBeCloseTo(8.5);
  });

  test("urls returns contentHash when stored on the media row", async () => {
    const t = convexTest(schema, modules);
    const { orgId } = await seedPrerequisites(t);
    const storageId = await seedStorageId(t);

    const contentHash =
      "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

    const mediaId = await t.run(async (ctx) => {
      return ctx.db.insert("media", {
        orgId,
        storageId: storageId as any,
        kind: "photo",
        contentHash,
      });
    });

    const results = await t.query(api.media.urls, { ids: [mediaId] });
    expect(results.length).toBe(1);
    expect(results[0].contentHash).toBe(contentHash);
  });

  test("urls returns all three provenance fields together", async () => {
    const t = convexTest(schema, modules);
    const { orgId } = await seedPrerequisites(t);
    const storageId = await seedStorageId(t);

    const capturedAt = new Date("2026-05-01T08:00:00.000Z").getTime();
    const geo = { lat: -33.8688, lng: 151.2093 };
    const contentHash =
      "cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe";

    const mediaId = await t.run(async (ctx) => {
      return ctx.db.insert("media", {
        orgId,
        storageId: storageId as any,
        kind: "photo",
        capturedAt,
        geo,
        contentHash,
      });
    });

    const results = await t.query(api.media.urls, { ids: [mediaId] });
    expect(results.length).toBe(1);

    const item = results[0];
    expect(item.capturedAt).toBe(capturedAt);
    expect(item.geo!.lat).toBeCloseTo(-33.8688);
    expect(item.geo!.lng).toBeCloseTo(151.2093);
    expect(item.contentHash).toBe(contentHash);

    // Existing fields still present.
    expect(item.mediaId).toBe(mediaId);
    expect(item.kind).toBe("photo");
  });

  test("urls returns undefined/null provenance fields when not stored (backward-compat)", async () => {
    const t = convexTest(schema, modules);
    const { orgId } = await seedPrerequisites(t);
    const storageId = await seedStorageId(t);

    const mediaId = await t.run(async (ctx) => {
      return ctx.db.insert("media", {
        orgId,
        storageId: storageId as any,
        kind: "doc",
        name: "old-doc.pdf",
        // No provenance fields at all.
      });
    });

    const results = await t.query(api.media.urls, { ids: [mediaId] });
    expect(results.length).toBe(1);

    const item = results[0];
    // Provenance fields must be absent or undefined — not crash.
    expect(item.capturedAt == null).toBe(true);
    expect(item.geo == null).toBe(true);
    expect(item.contentHash == null).toBe(true);
  });

  test("urls handles a mix of old and new media rows correctly", async () => {
    const t = convexTest(schema, modules);
    const { orgId } = await seedPrerequisites(t);
    const storageId = await seedStorageId(t);

    const capturedAt = new Date("2026-05-10T10:00:00.000Z").getTime();

    const oldId = await t.run(async (ctx) => {
      return ctx.db.insert("media", {
        orgId,
        storageId: storageId as any,
        kind: "photo",
        // no provenance
      });
    });

    const newId = await t.run(async (ctx) => {
      return ctx.db.insert("media", {
        orgId,
        storageId: storageId as any,
        kind: "photo",
        capturedAt,
        contentHash: "abc123",
      });
    });

    const results = await t.query(api.media.urls, { ids: [oldId, newId] });
    expect(results.length).toBe(2);

    const old = results.find((r) => r.mediaId === oldId)!;
    const nw = results.find((r) => r.mediaId === newId)!;

    expect(old.capturedAt == null).toBe(true);
    expect(old.contentHash == null).toBe(true);

    expect(nw.capturedAt).toBe(capturedAt);
    expect(nw.contentHash).toBe("abc123");
  });
});

// ---------------------------------------------------------------------------
// schema smoke: media table accepts new fields via direct db.insert
// ---------------------------------------------------------------------------

describe("media table schema — direct inserts (schema smoke)", () => {
  test("can insert a media row with capturedAt", async () => {
    const t = convexTest(schema, modules);
    const { orgId } = await seedPrerequisites(t);
    const storageId = await seedStorageId(t);

    const capturedAt = Date.now();

    const id = await t.run(async (ctx) => {
      return ctx.db.insert("media", {
        orgId,
        storageId: storageId as any,
        kind: "photo",
        capturedAt,
      });
    });

    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row).not.toBeNull();
    expect(row!.capturedAt).toBe(capturedAt);
  });

  test("can insert a media row with capturedBy", async () => {
    const t = convexTest(schema, modules);
    const { orgId, userId } = await seedPrerequisites(t);
    const storageId = await seedStorageId(t);

    const id = await t.run(async (ctx) => {
      return ctx.db.insert("media", {
        orgId,
        storageId: storageId as any,
        kind: "photo",
        capturedBy: userId,
      });
    });

    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row).not.toBeNull();
    expect(row!.capturedBy).toBe(userId);
  });

  test("can insert a media row with geo including accuracy", async () => {
    const t = convexTest(schema, modules);
    const { orgId } = await seedPrerequisites(t);
    const storageId = await seedStorageId(t);

    const geo = { lat: -37.8136, lng: 144.9631, accuracy: 2.5 };

    const id = await t.run(async (ctx) => {
      return ctx.db.insert("media", {
        orgId,
        storageId: storageId as any,
        kind: "photo",
        geo,
      });
    });

    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row).not.toBeNull();
    expect(row!.geo).toMatchObject({ lat: -37.8136, lng: 144.9631, accuracy: 2.5 });
  });

  test("can insert a media row with geo without accuracy (accuracy is optional)", async () => {
    const t = convexTest(schema, modules);
    const { orgId } = await seedPrerequisites(t);
    const storageId = await seedStorageId(t);

    const geo = { lat: -33.8688, lng: 151.2093 };

    const id = await t.run(async (ctx) => {
      return ctx.db.insert("media", {
        orgId,
        storageId: storageId as any,
        kind: "photo",
        geo,
      });
    });

    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row).not.toBeNull();
    expect(row!.geo!.lat).toBeCloseTo(-33.8688);
    expect(row!.geo!.accuracy).toBeUndefined();
  });

  test("can insert a media row with contentHash", async () => {
    const t = convexTest(schema, modules);
    const { orgId } = await seedPrerequisites(t);
    const storageId = await seedStorageId(t);

    const contentHash = "a".repeat(64); // 64-char hex sha256

    const id = await t.run(async (ctx) => {
      return ctx.db.insert("media", {
        orgId,
        storageId: storageId as any,
        kind: "doc",
        contentHash,
      });
    });

    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row).not.toBeNull();
    expect(row!.contentHash).toBe(contentHash);
  });
});

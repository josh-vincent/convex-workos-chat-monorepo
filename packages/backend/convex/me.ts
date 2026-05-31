// Bridges our WorkOS / guest auth identity to a Beacon org + user.
//
// The Beacon functions take orgId/inspectorId as args (they don't read ctx.auth),
// so the apps call `ensureUser` once after sign-in to provision/find a user in the
// seeded demo org, then use `current` for the reactive { orgId, userId }.
import { mutation, query } from "./_generated/server";

const DEMO_ORG_SLUG = "northwind";

async function demoOrg(ctx: { db: any }) {
  const org = await ctx.db
    .query("organizations")
    .withIndex("by_slug", (q: any) => q.eq("slug", DEMO_ORG_SLUG))
    .unique();
  if (!org) {
    throw new Error(
      `Demo org "${DEMO_ORG_SLUG}" not seeded. Run: pnpm --filter @packages/backend seed`,
    );
  }
  return org;
}

export const current = query({
  args: {},
  handler: async (ctx) => {
    const id = await ctx.auth.getUserIdentity();
    if (!id) return null;
    const org = await demoOrg(ctx);
    const email = id.email ?? `${id.subject}@guest.local`;
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    return {
      orgId: org._id,
      userId: user?._id ?? null,
      name: user?.name ?? (id.name as string | undefined) ?? "Field Technician",
      email,
      ready: user !== null,
    };
  },
});

export const ensureUser = mutation({
  args: {},
  handler: async (ctx) => {
    const id = await ctx.auth.getUserIdentity();
    if (!id) throw new Error("Not authenticated");
    const org = await demoOrg(ctx);
    const email = id.email ?? `${id.subject}@guest.local`;
    let user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (!user) {
      const isGuest = email.endsWith("@guest.local");
      const userId = await ctx.db.insert("users", {
        orgId: org._id,
        name:
          (id.name as string | undefined) ??
          (isGuest ? "Field Technician (Guest)" : email),
        email,
        authMethod: isGuest ? "email" : "sso",
      });
      await ctx.db.insert("memberships", {
        orgId: org._id,
        userId,
        role: "inspector",
      });
      user = await ctx.db.get(userId);
    }
    return { orgId: org._id, userId: user!._id, name: user!.name, email };
  },
});

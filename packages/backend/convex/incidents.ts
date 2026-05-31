// Notifiable incidents — spec §4 Tier 1, §6, §10, DoD #4.
//
// Provides a structured way to report workplace incidents, optionally flagging
// them as "notifiable" to surface the regulatory notification obligation.
// No automatic regulator contact — surface only.
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const DEFAULT_WINDOW_HOURS = 48;
const MS_PER_HOUR = 60 * 60 * 1000;

const incidentTypeValidator = v.union(
  v.literal("injury"),
  v.literal("near_miss"),
  v.literal("dangerous_occurrence"),
  v.literal("illness"),
);

// ---------------------------------------------------------------------------
// report — mutation
// ---------------------------------------------------------------------------

/**
 * Report a workplace incident.
 *
 * Inserts an issue with severity "critical", status "open" and the incident
 * fields. If notifiable===true the function also:
 *   1. Computes notifyDeadlineAt = occurredAt + window_hours * 3_600_000.
 *      The window is read from jurisdictionConfigs (key "notifiable_incident_window_hours",
 *      jurisdiction "generic") falling back to the hard-coded DEFAULT_WINDOW_HOURS (48).
 *   2. Inserts a CRITICAL alert of kind "notifiable_incident".
 *
 * Never auto-contacts a regulator.
 *
 * Returns the new issueId.
 */
export const report = mutation({
  args: {
    orgId: v.id("organizations"),
    anchorType: v.optional(v.string()),
    anchorId: v.optional(v.string()),
    incidentType: incidentTypeValidator,
    notifiable: v.boolean(),
    occurredAt: v.number(),
    description: v.string(),
    reportedBy: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const {
      orgId,
      anchorType,
      anchorId,
      incidentType,
      notifiable,
      occurredAt,
      description,
      reportedBy,
    } = args;

    // Determine deadline window. Look up jurisdiction config first.
    let windowHours = DEFAULT_WINDOW_HOURS;
    if (notifiable) {
      // Try the org's jurisdiction, then generic.
      const org = await ctx.db.get(orgId);
      const jurisdiction = org?.jurisdiction ?? "generic";

      // Look up jurisdiction-specific window.
      if (jurisdiction !== "generic") {
        const specific = await ctx.db
          .query("jurisdictionConfigs")
          .withIndex("by_jurisdiction_key", (q) =>
            q
              .eq("jurisdiction", jurisdiction)
              .eq("key", "notifiable_incident_window_hours"),
          )
          .first();
        if (specific !== null) {
          windowHours = specific.value as number;
        }
      }

      if (windowHours === DEFAULT_WINDOW_HOURS) {
        // Try generic fallback.
        const generic = await ctx.db
          .query("jurisdictionConfigs")
          .withIndex("by_jurisdiction_key", (q) =>
            q
              .eq("jurisdiction", "generic")
              .eq("key", "notifiable_incident_window_hours"),
          )
          .first();
        if (generic !== null) {
          windowHours = generic.value as number;
        }
      }
    }

    const notifyDeadlineAt = notifiable
      ? occurredAt + windowHours * MS_PER_HOUR
      : undefined;

    // We need a raisedBy user for the issues table. Use reportedBy if provided,
    // otherwise find the first user in the org (or create a system placeholder).
    let raisedBy = reportedBy;
    if (!raisedBy) {
      // Find any user in the org to satisfy the non-optional FK.
      const anyUser = await ctx.db
        .query("users")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .first();
      if (anyUser) {
        raisedBy = anyUser._id;
      } else {
        // Insert a system user for this org if none exists.
        raisedBy = await ctx.db.insert("users", {
          orgId,
          name: "System",
          authMethod: "email",
        });
      }
    }

    const issueId = await ctx.db.insert("issues", {
      orgId,
      raisedBy,
      title: description,
      description,
      severity: "critical",
      status: "open",
      incidentType,
      notifiable,
      occurredAt,
      ...(notifyDeadlineAt !== undefined ? { notifyDeadlineAt } : {}),
    });

    if (notifiable) {
      const deadline = new Date(notifyDeadlineAt!).toISOString();
      await ctx.db.insert("alerts", {
        orgId,
        kind: "notifiable_incident",
        severity: "critical",
        message: `Notifiable incident reported. Regulatory notification required by ${deadline}.`,
        status: "open",
        createdAt: Date.now(),
      });
    }

    return issueId;
  },
});

// ---------------------------------------------------------------------------
// list — query
// ---------------------------------------------------------------------------

/**
 * Return all issues for the org that have a non-undefined incidentType field,
 * ordered by _creationTime descending.
 */
export const list = query({
  args: {
    orgId: v.id("organizations"),
  },
  handler: async (ctx, { orgId }) => {
    const allIssues = await ctx.db
      .query("issues")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .collect();

    return allIssues.filter((issue) => issue.incidentType !== undefined);
  },
});

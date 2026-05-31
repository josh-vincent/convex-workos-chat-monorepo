// Beacon backend — Convex schema.
//
// Design notes (see docs/03-rebuild-blueprint.md):
//  - Multi-tenant: every row carries `orgId`. (Production would add row-level rules.)
//  - NON-DESTRUCTIVE TEMPLATE VERSIONING: `templates` holds metadata; each edit creates a
//    new immutable `templateVersions` row. An inspection pins the exact `templateVersionId`
//    it ran on, so historical inspections always reproduce exactly — fixing the #1
//    SafetyCulture complaint (editing a published template forces a rebuild).
//  - Dynamic forms: a template version stores `sections[].questions[]`; inspection answers
//    are stored as `responses[]` keyed by `questionId` (value typed as v.any()).
//  - Append-only `auditLog` underpins compliance / "who changed what".
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// ---------------------------------------------------------------------------
// Reusable validators
// ---------------------------------------------------------------------------

/** Jurisdiction codes supported by the platform. */
export const jurisdictionUnion = v.union(
  v.literal("vic_ohs"),
  v.literal("whs_harmonised"),
  v.literal("generic"),
);

/** Every question/answer field type Beacon supports. */
export const questionType = v.union(
  v.literal("instruction"), // display-only guidance, no answer
  v.literal("passFailNA"),
  v.literal("text"),
  v.literal("number"),
  v.literal("temperature"), // number + pass-range (min/max) with auto-flag
  v.literal("multipleChoice"),
  v.literal("checkbox"),
  v.literal("date"),
  v.literal("datetime"),
  v.literal("signature"),
  v.literal("photo"),
  v.literal("media"),
  v.literal("slider"),
  v.literal("siteSelect"),
  v.literal("assetScan"), // scan a QR/barcode to bind an asset
  // SafetyCulture-native field types ingested by the library importer
  // (see convex/libraryTemplates/transform.ts).
  v.literal("question"), // response-set question, default Yes / No / N/A
  v.literal("list"), // single-select dropdown / response list
  v.literal("address"), // postal / site address
  v.literal("drawing"), // annotated drawing / sketch
);

const questionOption = v.object({
  label: v.string(),
  score: v.optional(v.number()), // contribution to scoring
  flag: v.optional(v.boolean()), // selecting this is a "fail"/risk
});

/** Conditional visibility: show this question only when another answer matches. */
const visibleWhen = v.object({
  questionId: v.string(),
  equals: v.optional(v.string()),
  notEquals: v.optional(v.string()),
});

export const question = v.object({
  id: v.string(), // stable within a template version
  label: v.string(),
  type: questionType,
  required: v.optional(v.boolean()),
  helpText: v.optional(v.string()),
  options: v.optional(v.array(questionOption)),
  min: v.optional(v.number()), // number/temperature/slider lower bound
  max: v.optional(v.number()), // number/temperature/slider upper bound
  unit: v.optional(v.string()), // e.g. "°C", "psi", "km"
  weight: v.optional(v.number()), // scoring weight (default 1)
  visibleWhen: v.optional(visibleWhen),
  triggersActionOnFail: v.optional(v.boolean()), // auto-create a corrective action on fail
  requireNote: v.optional(v.boolean()), // a written note is mandatory to complete
  requirePhoto: v.optional(v.boolean()), // photo/document evidence is mandatory to complete
});

export const section = v.object({
  id: v.string(),
  title: v.string(),
  description: v.optional(v.string()),
  level: v.optional(v.number()), // original nesting depth (1 = top level), for indentation
  questions: v.array(question),
});

const severity = v.union(
  v.literal("low"),
  v.literal("medium"),
  v.literal("high"),
  v.literal("critical"),
);

// Which product MODULE a shared record belongs to. Safety is just the first of several
// domains on the same platform (see docs/14-platform-architecture.md). New modules add a
// literal here and reuse the shared tables (forms, tasks, assets, people) unchanged.
export const moduleKey = v.union(
  v.literal("safety"),
  v.literal("maintenance"),
  v.literal("hr"),
  v.literal("projects"),
  v.literal("quality"),
  v.literal("operations"),
);

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export default defineSchema({
  organizations: defineTable({
    name: v.string(),
    slug: v.string(),
    plan: v.union(
      v.literal("free"),
      v.literal("team"),
      v.literal("business"),
      v.literal("enterprise"),
    ),
    dataRetentionYears: v.optional(v.number()),
    jurisdiction: v.optional(jurisdictionUnion),
  }).index("by_slug", ["slug"]),

  // Region › site › area hierarchy via self-referential parentSiteId.
  sites: defineTable({
    orgId: v.id("organizations"),
    name: v.string(),
    code: v.optional(v.string()),
    parentSiteId: v.optional(v.id("sites")),
    region: v.optional(v.string()),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
  })
    .index("by_org", ["orgId"])
    .index("by_parent", ["parentSiteId"]),

  users: defineTable({
    orgId: v.id("organizations"),
    name: v.string(),
    email: v.optional(v.string()),
    // Shared industrial/kiosk devices sign in with a PIN or badge (no per-seat tax).
    authMethod: v.union(
      v.literal("email"),
      v.literal("sso"),
      v.literal("pin"),
      v.literal("badge"),
    ),
  })
    .index("by_org", ["orgId"])
    .index("by_email", ["email"]),

  memberships: defineTable({
    orgId: v.id("organizations"),
    userId: v.id("users"),
    role: v.union(
      v.literal("admin"),
      v.literal("manager"),
      v.literal("inspector"),
      v.literal("contributor"), // light seat: view + actions + limited inspections
      v.literal("viewer"),
    ),
    siteScope: v.optional(v.array(v.id("sites"))), // empty/undefined = all sites
  })
    .index("by_org", ["orgId"])
    .index("by_org_user", ["orgId", "userId"]),

  // Template METADATA. Content lives in versioned templateVersions rows.
  // NOTE: this is the PLATFORM form engine — not safety-specific. Safety inspections,
  // maintenance checklists, HR onboarding forms and project gate reviews are all just
  // templates with a different `module` (see docs/14-platform-architecture.md).
  templates: defineTable({
    orgId: v.id("organizations"),
    module: v.optional(moduleKey), // which product module owns this template (default: safety)
    key: v.string(), // stable, e.g. "construction.daily_site_safety_walk"
    name: v.string(),
    category: v.string(),
    industry: v.string(),
    description: v.optional(v.string()),
    packKey: v.optional(v.string()), // which template pack it came from
    currentVersion: v.number(),
    status: v.union(
      v.literal("draft"),
      v.literal("published"),
      v.literal("archived"),
    ),
    // Provenance — distinguishes curated packs from imported library templates.
    source: v.optional(
      v.union(v.literal("pack"), v.literal("library"), v.literal("custom")),
    ),
    author: v.optional(v.string()), // original library author/attribution
    sourceUrl: v.optional(v.string()), // link back to the public source
    downloads: v.optional(v.number()), // popularity signal from the source library
    fieldCount: v.optional(v.number()), // denormalised answerable-field count
    // Sharing: "private" = this org only; "public" = shared into every org's library.
    // Undefined is treated as private.
    visibility: v.optional(v.union(v.literal("private"), v.literal("public"))),
    jurisdiction: v.optional(jurisdictionUnion),
  })
    .index("by_org", ["orgId"])
    .index("by_org_key", ["orgId", "key"])
    .index("by_pack", ["packKey"])
    .index("by_visibility", ["visibility"])
    // Full-text search so a library of *infinite* templates stays browsable/searchable
    // server-side (never "collect() everything"). Filter fields keep results org-scoped.
    .searchIndex("search_name", {
      searchField: "name",
      filterFields: ["orgId", "industry", "packKey", "status"],
    }),

  // Immutable snapshot of a template's content at a point in time.
  templateVersions: defineTable({
    templateId: v.id("templates"),
    version: v.number(),
    sections: v.array(section),
    scoringEnabled: v.boolean(),
    changeNote: v.optional(v.string()),
    createdBy: v.optional(v.id("users")),
  })
    .index("by_template", ["templateId"])
    .index("by_template_version", ["templateId", "version"]),

  inspections: defineTable({
    orgId: v.id("organizations"),
    siteId: v.optional(v.id("sites")),
    templateId: v.id("templates"),
    templateVersionId: v.id("templateVersions"), // frozen version it ran on
    version: v.number(),
    inspectorId: v.id("users"),
    status: v.union(
      v.literal("in_progress"),
      v.literal("completed"),
      v.literal("submitted"),
    ),
    score: v.optional(v.number()), // 0–100 percent
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    responses: v.array(
      v.object({
        questionId: v.string(),
        value: v.optional(v.any()), // string | number | boolean | string[]
        note: v.optional(v.string()),
        mediaIds: v.optional(v.array(v.id("media"))),
        flagged: v.optional(v.boolean()), // failed / out-of-range
      }),
    ),
    assetId: v.optional(v.id("assets")),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    dueAt: v.optional(v.number()),
    // Generated PDF report (see convex/reports.ts) — file storage id + its media row.
    reportStorageId: v.optional(v.id("_storage")),
    reportMediaId: v.optional(v.id("media")),
    // Anchor graph (spec §2, §5.2, §8) — links an inspection to a job/site/contract/person/asset.
    anchorType: v.optional(
      v.union(
        v.literal("job"),
        v.literal("site"),
        v.literal("contract"),
        v.literal("person"),
        v.literal("asset"),
      ),
    ),
    anchorId: v.optional(v.string()),
  })
    .index("by_org", ["orgId"])
    .index("by_site", ["siteId"])
    .index("by_template", ["templateId"])
    .index("by_inspector", ["inspectorId"])
    .index("by_org_status", ["orgId", "status"])
    .index("by_anchor", ["anchorType", "anchorId"]),

  issues: defineTable({
    orgId: v.id("organizations"),
    siteId: v.optional(v.id("sites")),
    raisedBy: v.id("users"),
    title: v.string(),
    description: v.optional(v.string()),
    category: v.optional(v.string()),
    severity,
    status: v.union(
      v.literal("open"),
      v.literal("in_progress"),
      v.literal("resolved"),
      v.literal("closed"),
    ),
    assetId: v.optional(v.id("assets")),
    inspectionId: v.optional(v.id("inspections")),
    mediaIds: v.optional(v.array(v.id("media"))),
  })
    .index("by_org", ["orgId"])
    .index("by_site", ["siteId"])
    .index("by_org_status", ["orgId", "status"]),

  // The PLATFORM task inbox. Every module raises tasks here (corrective actions, work-order
  // follow-ups, onboarding to-dos, project actions) so a person has ONE list of what they owe.
  actions: defineTable({
    orgId: v.id("organizations"),
    module: v.optional(moduleKey), // which module raised it (default: safety)
    siteId: v.optional(v.id("sites")),
    title: v.string(),
    description: v.optional(v.string()),
    assigneeId: v.optional(v.id("users")),
    priority: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
    status: v.union(
      v.literal("todo"),
      v.literal("in_progress"),
      v.literal("done"),
    ),
    dueDate: v.optional(v.number()),
    source: v.union(
      v.literal("inspection"),
      v.literal("issue"),
      v.literal("manual"),
      v.literal("schedule"),
      v.literal("work_order"), // maintenance
      v.literal("onboarding"), // hr
      v.literal("project"), // projects
    ),
    inspectionId: v.optional(v.id("inspections")),
    issueId: v.optional(v.id("issues")),
    workOrderId: v.optional(v.id("workOrders")),
    projectId: v.optional(v.id("projects")),
    recurringRule: v.optional(v.string()),
    completedAt: v.optional(v.number()),
  })
    .index("by_org", ["orgId"])
    .index("by_assignee", ["assigneeId"])
    .index("by_org_status", ["orgId", "status"])
    .index("by_org_module", ["orgId", "module"]),

  assets: defineTable({
    orgId: v.id("organizations"),
    siteId: v.optional(v.id("sites")),
    name: v.string(),
    type: v.string(), // e.g. "forklift", "fridge", "fire_extinguisher"
    qrCode: v.string(),
    status: v.union(
      v.literal("operational"),
      v.literal("maintenance"),
      v.literal("out_of_service"),
    ),
    lastInspectionAt: v.optional(v.number()),
    nextDueAt: v.optional(v.number()),
  })
    .index("by_org", ["orgId"])
    .index("by_qr", ["qrCode"]),

  sensors: defineTable({
    orgId: v.id("organizations"),
    assetId: v.optional(v.id("assets")),
    name: v.string(),
    kind: v.union(
      v.literal("temperature"),
      v.literal("humidity"),
      v.literal("gas"),
      v.literal("telematics"),
    ),
    unit: v.string(),
    thresholdMin: v.optional(v.number()),
    thresholdMax: v.optional(v.number()),
    lastValue: v.optional(v.number()),
    lastReadingAt: v.optional(v.number()),
  }).index("by_org", ["orgId"]),

  sensorReadings: defineTable({
    sensorId: v.id("sensors"),
    value: v.number(),
    at: v.number(),
    flagged: v.boolean(), // outside threshold
  }).index("by_sensor_time", ["sensorId", "at"]),

  // Recurring inspection schedules (the "make sure it actually gets done" job).
  schedules: defineTable({
    orgId: v.id("organizations"),
    templateId: v.id("templates"),
    siteId: v.optional(v.id("sites")),
    assigneeId: v.optional(v.id("users")),
    rule: v.string(), // human/cron-ish, e.g. "daily@08:00", "per-shift"
    nextRunAt: v.number(),
    active: v.boolean(),
  })
    .index("by_org", ["orgId"])
    .index("by_next_run", ["nextRunAt"]),

  media: defineTable({
    orgId: v.id("organizations"),
    storageId: v.id("_storage"),
    kind: v.union(
      v.literal("photo"),
      v.literal("video"),
      v.literal("signature"),
      v.literal("doc"),
    ),
    name: v.optional(v.string()), // original filename (for document chips)
    uploadedBy: v.optional(v.id("users")),
  }).index("by_org", ["orgId"]),

  // Append-only audit trail (compliance + data trust). Never updated/deleted.
  auditLog: defineTable({
    orgId: v.id("organizations"),
    actorId: v.optional(v.id("users")),
    action: v.string(), // e.g. "inspection.completed", "template.versioned"
    entityTable: v.string(),
    entityId: v.string(),
    at: v.number(),
    meta: v.optional(v.any()),
  })
    .index("by_org", ["orgId"])
    .index("by_entity", ["entityTable", "entityId"]),

  // Lightweight training (micro-courses) — see docs roadmaps.
  courses: defineTable({
    orgId: v.id("organizations"),
    title: v.string(),
    description: v.optional(v.string()),
    lessonCount: v.number(),
  }).index("by_org", ["orgId"]),

  enrollments: defineTable({
    orgId: v.id("organizations"),
    courseId: v.id("courses"),
    userId: v.id("users"),
    progress: v.number(), // 0–100
    completedAt: v.optional(v.number()),
  })
    .index("by_course", ["courseId"])
    .index("by_user", ["userId"]),

  // =========================================================================
  // MODULE: MAINTENANCE — work orders against the SAME `assets` the safety
  // module inspects (one asset-360 view). A failed inspection can raise a work
  // order; completing a work order can schedule the next preventive inspection.
  // =========================================================================
  workOrders: defineTable({
    orgId: v.id("organizations"),
    siteId: v.optional(v.id("sites")),
    assetId: v.optional(v.id("assets")), // shared platform asset
    title: v.string(),
    description: v.optional(v.string()),
    kind: v.union(
      v.literal("preventive"),
      v.literal("corrective"),
      v.literal("breakdown"),
      v.literal("inspection_followup"), // raised from a safety inspection
    ),
    priority: v.union(v.literal("low"), v.literal("medium"), v.literal("high"), v.literal("critical")),
    status: v.union(
      v.literal("open"),
      v.literal("scheduled"),
      v.literal("in_progress"),
      v.literal("on_hold"),
      v.literal("completed"),
      v.literal("cancelled"),
    ),
    assignedToId: v.optional(v.id("users")), // shared platform person
    inspectionId: v.optional(v.id("inspections")), // provenance if it came from safety
    scheduledFor: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    laborHours: v.optional(v.number()),
    partsCost: v.optional(v.number()),
  })
    .index("by_org", ["orgId"])
    .index("by_org_status", ["orgId", "status"])
    .index("by_asset", ["assetId"])
    .index("by_assignee", ["assignedToId"]),

  // =========================================================================
  // MODULE: HR / PEOPLE — extends the platform `users` (identity) with employment
  // data. Keeping HR data in its own table (not on `users`) means modules that only
  // need identity never load it. `managerId` self-references for org charts.
  // =========================================================================
  people: defineTable({
    orgId: v.id("organizations"),
    userId: v.id("users"), // links to the platform identity row
    employeeNo: v.optional(v.string()),
    jobTitle: v.optional(v.string()),
    department: v.optional(v.string()),
    managerId: v.optional(v.id("users")), // reporting line (manager of projects, etc.)
    employmentType: v.optional(
      v.union(v.literal("full_time"), v.literal("part_time"), v.literal("contractor"), v.literal("casual")),
    ),
    primarySiteId: v.optional(v.id("sites")),
    startedAt: v.optional(v.number()),
    status: v.union(v.literal("onboarding"), v.literal("active"), v.literal("on_leave"), v.literal("offboarded")),
  })
    .index("by_org", ["orgId"])
    .index("by_user", ["userId"])
    .index("by_manager", ["managerId"]),

  // Competencies/tickets a person holds (e.g. forklift licence, first aid, working-at-heights).
  // The safety module reads these to gate who may perform a task; HR owns expiry/renewal.
  certifications: defineTable({
    orgId: v.id("organizations"),
    userId: v.id("users"),
    name: v.string(),
    issuer: v.optional(v.string()),
    issuedAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    mediaId: v.optional(v.id("media")), // scanned certificate (shared media store)
    status: v.union(v.literal("valid"), v.literal("expiring"), v.literal("expired")),
  })
    .index("by_org", ["orgId"])
    .index("by_user", ["userId"])
    .index("by_org_expiry", ["orgId", "expiresAt"]),

  // =========================================================================
  // MODULE: PROJECTS — a manager of projects groups work across sites. Inspections,
  // work orders and actions can all reference a project for a single rollup.
  // =========================================================================
  projects: defineTable({
    orgId: v.id("organizations"),
    name: v.string(),
    code: v.optional(v.string()),
    description: v.optional(v.string()),
    siteId: v.optional(v.id("sites")),
    managerId: v.optional(v.id("users")), // the project manager (a platform person)
    status: v.union(
      v.literal("planning"),
      v.literal("active"),
      v.literal("on_hold"),
      v.literal("complete"),
      v.literal("archived"),
    ),
    startDate: v.optional(v.number()),
    targetEndDate: v.optional(v.number()),
    budget: v.optional(v.number()),
  })
    .index("by_org", ["orgId"])
    .index("by_manager", ["managerId"])
    .index("by_org_status", ["orgId", "status"]),

  // Project membership + role (separate from org-level memberships).
  projectMembers: defineTable({
    orgId: v.id("organizations"),
    projectId: v.id("projects"),
    userId: v.id("users"),
    role: v.union(v.literal("lead"), v.literal("member"), v.literal("stakeholder")),
  })
    .index("by_project", ["projectId"])
    .index("by_user", ["userId"]),

  // =========================================================================
  // ANCHOR GRAPH — spec §2, §5.2, §8 (DoD #8)
  // Records anchor to a job/site/contract/person/asset graph.
  // =========================================================================

  jobs: defineTable({
    orgId: v.id("organizations"),
    name: v.string(),
    siteId: v.optional(v.id("sites")),
    status: v.union(
      v.literal("draft"),
      v.literal("active"),
      v.literal("complete"),
    ),
    hrcw: v.optional(v.boolean()), // high-risk construction work flag
    startedReady: v.optional(v.boolean()),
  }).index("by_org", ["orgId"]),

  contracts: defineTable({
    orgId: v.id("organizations"),
    name: v.string(),
    status: v.optional(v.string()),
  }).index("by_org", ["orgId"]),

  subcontractors: defineTable({
    orgId: v.id("organizations"),
    name: v.string(),
    status: v.optional(v.string()),
  }).index("by_org", ["orgId"]),

  // =========================================================================
  // REGISTER ENTRIES — spec §5.3, DoD #4
  // Tracks currency of licences, competencies, SDS, insurance, plant, and
  // inductions against a person / site / asset / subcontractor anchor.
  // `status` is NEVER stored — it is always derived at query time via
  // convex/lib/currency.ts#currencyStatus().
  // =========================================================================
  registerEntries: defineTable({
    orgId: v.id("organizations"),
    registerType: v.union(
      v.literal("licence"),
      v.literal("competency"),
      v.literal("sds"),
      v.literal("insurance"),
      v.literal("plant"),
      v.literal("induction"),
    ),
    anchorType: v.union(
      v.literal("person"),
      v.literal("site"),
      v.literal("asset"),
      v.literal("subcontractor"),
    ),
    anchorId: v.string(),
    label: v.string(),
    identifier: v.optional(v.string()),
    issuedAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    reviewEveryDays: v.optional(v.number()),
    leadTimeDays: v.optional(v.number()),
    documentRef: v.optional(v.id("media")),
    verifiedBy: v.optional(v.id("users")),
  })
    .index("by_org", ["orgId"])
    .index("by_anchor", ["anchorType", "anchorId"]),

  // =========================================================================
  // ALERTS — spec §6, DoD #5
  // Daily currency sweep raises alerts for expiring/expired/review_due entries
  // and overdue inspections. Status is stored (open → acknowledged → resolved).
  // =========================================================================
  // =========================================================================
  // JURISDICTION CONFIGS — spec §11, DoD #9
  // Config-driven jurisdiction values. No hard-coded constants.
  // Key/value store partitioned by jurisdiction; "generic" is the fallback.
  // =========================================================================
  jurisdictionConfigs: defineTable({
    jurisdiction: jurisdictionUnion,
    key: v.string(),
    value: v.any(),
  }).index("by_jurisdiction_key", ["jurisdiction", "key"]),

  alerts: defineTable({
    orgId: v.id("organizations"),
    kind: v.union(
      v.literal("expiring_soon"),
      v.literal("expired"),
      v.literal("overdue"),
      v.literal("review_due"),
    ),
    severity: v.union(
      v.literal("low"),
      v.literal("medium"),
      v.literal("high"),
      v.literal("critical"),
    ),
    registerEntryId: v.optional(v.id("registerEntries")),
    inspectionId: v.optional(v.id("inspections")),
    message: v.string(),
    status: v.union(
      v.literal("open"),
      v.literal("acknowledged"),
      v.literal("resolved"),
    ),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_entry_kind", ["registerEntryId", "kind"])
    .index("by_inspection_kind", ["inspectionId", "kind"]),
});

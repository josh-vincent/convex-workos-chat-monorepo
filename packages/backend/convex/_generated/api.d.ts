/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as actions from "../actions.js";
import type * as analytics from "../analytics.js";
import type * as components_ from "../components.js";
import type * as crons from "../crons.js";
import type * as currency from "../currency.js";
import type * as dev from "../dev.js";
import type * as http from "../http.js";
import type * as inspections from "../inspections.js";
import type * as issues from "../issues.js";
import type * as jobs from "../jobs.js";
import type * as jurisdiction from "../jurisdiction.js";
import type * as lib_currency from "../lib/currency.js";
import type * as lib_retention from "../lib/retention.js";
import type * as lib_scoring from "../lib/scoring.js";
import type * as libraryTemplates_transform from "../libraryTemplates/transform.js";
import type * as maintenance from "../maintenance.js";
import type * as me from "../me.js";
import type * as media from "../media.js";
import type * as orgs from "../orgs.js";
import type * as records from "../records.js";
import type * as registers from "../registers.js";
import type * as reportData from "../reportData.js";
import type * as reports from "../reports.js";
import type * as seed from "../seed.js";
import type * as templatePacks_construction from "../templatePacks/construction.js";
import type * as templatePacks_facilities from "../templatePacks/facilities.js";
import type * as templatePacks_foodHospitality from "../templatePacks/foodHospitality.js";
import type * as templatePacks_index from "../templatePacks/index.js";
import type * as templatePacks_manufacturing from "../templatePacks/manufacturing.js";
import type * as templatePacks_retail from "../templatePacks/retail.js";
import type * as templatePacks_transport from "../templatePacks/transport.js";
import type * as templatePacks_types from "../templatePacks/types.js";
import type * as templates from "../templates.js";
import type * as workflows from "../workflows.js";
import type * as workspace from "../workspace.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  actions: typeof actions;
  analytics: typeof analytics;
  components: typeof components_;
  crons: typeof crons;
  currency: typeof currency;
  dev: typeof dev;
  http: typeof http;
  inspections: typeof inspections;
  issues: typeof issues;
  jobs: typeof jobs;
  jurisdiction: typeof jurisdiction;
  "lib/currency": typeof lib_currency;
  "lib/retention": typeof lib_retention;
  "lib/scoring": typeof lib_scoring;
  "libraryTemplates/transform": typeof libraryTemplates_transform;
  maintenance: typeof maintenance;
  me: typeof me;
  media: typeof media;
  orgs: typeof orgs;
  records: typeof records;
  registers: typeof registers;
  reportData: typeof reportData;
  reports: typeof reports;
  seed: typeof seed;
  "templatePacks/construction": typeof templatePacks_construction;
  "templatePacks/facilities": typeof templatePacks_facilities;
  "templatePacks/foodHospitality": typeof templatePacks_foodHospitality;
  "templatePacks/index": typeof templatePacks_index;
  "templatePacks/manufacturing": typeof templatePacks_manufacturing;
  "templatePacks/retail": typeof templatePacks_retail;
  "templatePacks/transport": typeof templatePacks_transport;
  "templatePacks/types": typeof templatePacks_types;
  templates: typeof templates;
  workflows: typeof workflows;
  workspace: typeof workspace;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  actionRetrier: import("@convex-dev/action-retrier/_generated/component.js").ComponentApi<"actionRetrier">;
  workflow: import("@convex-dev/workflow/_generated/component.js").ComponentApi<"workflow">;
  scoreByOrg: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"scoreByOrg">;
  scoreBySite: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"scoreBySite">;
};

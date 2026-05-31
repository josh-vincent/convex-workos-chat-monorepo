// Shared TypeScript types for Beacon vertical TEMPLATE PACKS.
//
// A "pack" is a curated set of ready-to-run inspection templates for one industry.
// These plain-data definitions are consumed by `convex/seed.ts`, which writes them into
// the `templates` + `templateVersions` tables (see convex/schema.ts). The field types here
// mirror the `question`/`section` validators in the schema exactly.

export type QuestionType =
  | "instruction"
  | "passFailNA"
  | "text"
  | "number"
  | "temperature"
  | "multipleChoice"
  | "checkbox"
  | "date"
  | "datetime"
  | "signature"
  | "photo"
  | "media"
  | "slider"
  | "siteSelect"
  | "assetScan"
  // SafetyCulture-native field types (see convex/libraryTemplates/transform.ts):
  | "question" // response-set question, default Yes / No / N/A (their most common field)
  | "list" // single-select dropdown / response list
  | "address" // postal / site address
  | "drawing"; // annotated drawing / sketch

export interface QuestionOption {
  label: string;
  /** Contribution to the section/template score when chosen. */
  score?: number;
  /** Selecting this option counts as a fail / risk flag. */
  flag?: boolean;
}

export interface VisibleWhen {
  questionId: string;
  equals?: string;
  notEquals?: string;
}

export interface Question {
  /** Stable id, unique within the template. */
  id: string;
  label: string;
  type: QuestionType;
  required?: boolean;
  helpText?: string;
  /** For multipleChoice / checkbox. */
  options?: QuestionOption[];
  /** For number / temperature / slider: acceptable range. Outside => flagged. */
  min?: number;
  max?: number;
  unit?: string;
  /** Scoring weight (default 1). */
  weight?: number;
  /** Conditional visibility. */
  visibleWhen?: VisibleWhen;
  /** A failing/out-of-range answer auto-creates a corrective action. */
  triggersActionOnFail?: boolean;
}

export interface Section {
  id: string;
  title: string;
  description?: string;
  /** Nesting depth of the original section (1 = top level). For indentation. */
  level?: number;
  questions: Question[];
}

export interface TemplateDef {
  /** Stable key, e.g. "construction.daily_site_safety_walk". */
  key: string;
  name: string;
  category: string;
  industry: string;
  description?: string;
  /** Whether this template produces a 0–100 score. */
  scoringEnabled?: boolean;
  /** Where the template came from: a curated pack, the imported library, or user-built. */
  source?: "pack" | "library" | "custom";
  /** Library provenance (set for imported SafetyCulture templates). */
  author?: string;
  sourceUrl?: string;
  downloads?: number;
  /** Total answerable fields (denormalised for display). */
  fieldCount?: number;
  sections: Section[];
}

export interface TemplatePack {
  /** Stable pack key, e.g. "construction". */
  key: string;
  name: string;
  industry: string;
  description: string;
  templates: TemplateDef[];
}

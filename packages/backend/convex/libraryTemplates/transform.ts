// Pure transform: real SafetyCulture library JSON  ->  Beacon template definitions.
//
// SafetyCulture's public template library exports an arbitrarily-NESTED tree
// (`structure[].children[]`, where a child is either a field or another section,
// nested up to ~47 levels deep, with hundreds of empty-named sections that act as
// conditional/logic wrappers). Beacon stores a template version as a FLAT, ordered
// list of `sections[].questions[]` rendered by one generic engine.
//
// This module normalises the former into the latter:
//   - every NAMED section becomes one Beacon section (its hierarchy preserved in the
//     title as "Parent › Child"),
//   - EMPTY-named sections are inlined into their nearest named ancestor (so the 586
//     logic wrappers collapse away instead of exploding into noise),
//   - each SafetyCulture field type is mapped to a Beacon QuestionType.
//
// It has NO Convex / fs / JSON-import dependencies, so it is safe to bundle and trivial
// to unit-test. The build step (`scripts/buildLibrary.ts`) reads the JSON and calls this.
import type { Question, QuestionType, Section, TemplateDef } from "../templatePacks/types";

// ---------------------------------------------------------------------------
// Shape of the raw SafetyCulture export
// ---------------------------------------------------------------------------

export interface SCField {
  field: string;
  type: string;
  mandatory?: boolean;
}
export interface SCSection {
  section: string;
  children: SCNode[];
}
export type SCNode = SCField | SCSection;

export interface SCTemplate {
  title: string;
  category: string;
  downloads?: number;
  downloads_text?: string;
  author?: string;
  link?: string;
  description?: string;
  field_count?: number;
  types?: Record<string, number>;
  structure: SCSection[];
}

function isSection(n: SCNode): n is SCSection {
  const r = n as unknown as Record<string, unknown>;
  return Array.isArray(r.children) && typeof r.section === "string";
}
function isField(n: SCNode): n is SCField {
  const r = n as unknown as Record<string, unknown>;
  return typeof r.field === "string" && r.children === undefined;
}

// ---------------------------------------------------------------------------
// Type mapping: SafetyCulture field type  ->  Beacon QuestionType
// ---------------------------------------------------------------------------

const TYPE_MAP: Record<string, QuestionType> = {
  textsingle: "text",
  text: "text",
  datetime: "datetime",
  address: "address",
  question: "question", // SafetyCulture's core response-set field (Yes / No / N/A)
  list: "list",
  instruction: "instruction",
  category: "instruction", // a sub-heading label — render as display-only
  media: "media",
  signature: "signature",
  slider: "slider",
  checkbox: "checkbox",
  site: "siteSelect",
  asset: "assetScan",
  drawing: "drawing",
  logicfield: "instruction", // a bare logic marker — keep as a note
};

export function mapType(scType: string): QuestionType {
  return TYPE_MAP[scType] ?? "text";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

/** "transport-and-logistics" -> "Transport & Logistics". */
export function humanizeCategory(slug: string): string {
  return slug
    .replace(/-and-/g, " & ")
    .split("-")
    .map((w) => (w.length <= 3 && w === w.toLowerCase() && /^(of|to|in)$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

// ---------------------------------------------------------------------------
// Structure flattening
// ---------------------------------------------------------------------------

/**
 * Walk SafetyCulture's nested structure into a flat, ordered Section[].
 * Named sections create Beacon sections (hierarchy kept in the title); empty-named
 * sections are inlined into the nearest named ancestor.
 */
export function flattenStructure(structure: SCSection[]): Section[] {
  const sections: Section[] = [];
  let qCounter = 0;
  let sCounter = 0;

  const newSection = (title: string, level: number): Section => {
    const s: Section = { id: `s${++sCounter}`, title: title || "General", level, questions: [] };
    sections.push(s);
    return s;
  };

  const toQuestion = (f: SCField): Question => {
    const q: Question = {
      id: `q${++qCounter}`,
      label: (f.field || "Untitled").trim().slice(0, 400) || "Untitled",
      type: mapType(f.type),
    };
    if (f.mandatory === true) q.required = true;
    return q;
  };

  const walk = (node: SCSection, namedAncestors: string[], host: Section | null) => {
    const name = (node.section ?? "").trim();
    const named = name.length > 0;

    let currentHost = host;
    let ancestors = namedAncestors;
    if (named) {
      ancestors = [...namedAncestors, name];
      currentHost = newSection(ancestors.join(" › "), ancestors.length);
    }

    for (const child of node.children ?? []) {
      if (isSection(child)) {
        walk(child, ancestors, currentHost);
      } else if (isField(child)) {
        if (!currentHost) currentHost = newSection("General", 1);
        currentHost.questions.push(toQuestion(child));
      }
    }
  };

  for (const top of structure ?? []) walk(top, [], null);

  // Drop pure-header sections that ended up with no questions of their own — their
  // content already lives in their (named) child sections.
  return sections.filter((s) => s.questions.length > 0);
}

// ---------------------------------------------------------------------------
// Template transform
// ---------------------------------------------------------------------------

export interface TransformOptions {
  /** Ensures keys are globally unique across the library. */
  takenKeys?: Set<string>;
}

export function transformTemplate(raw: SCTemplate, opts: TransformOptions = {}): TemplateDef {
  const industry = humanizeCategory(raw.category || "general");
  const sections = flattenStructure(raw.structure || []);

  let key = `safetyculture.${slugify(raw.title)}`;
  if (opts.takenKeys) {
    let candidate = key;
    let n = 2;
    while (opts.takenKeys.has(candidate)) candidate = `${key}_${n++}`;
    key = candidate;
    opts.takenKeys.add(key);
  }

  const fieldCount = sections.reduce((sum, s) => sum + s.questions.length, 0);

  return {
    key,
    name: raw.title,
    category: industry,
    industry,
    description: raw.description?.trim() || undefined,
    scoringEnabled: true,
    source: "library",
    author: raw.author?.trim() || undefined,
    sourceUrl: raw.link?.trim() || undefined,
    downloads: typeof raw.downloads === "number" ? raw.downloads : undefined,
    fieldCount,
    sections,
  };
}

export function transformLibrary(raws: SCTemplate[]): TemplateDef[] {
  const takenKeys = new Set<string>();
  return raws
    .map((r) => transformTemplate(r, { takenKeys }))
    .filter((t) => t.sections.length > 0);
}

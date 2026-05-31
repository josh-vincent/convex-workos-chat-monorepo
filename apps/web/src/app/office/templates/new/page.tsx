"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useMutation } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";
import { useBeacon } from "@/hooks/useBeacon";
import { ChevronLeft, GripVertical, Plus, Trash2 } from "lucide-react";

type QType =
  | "passFailNA"
  | "checkbox"
  | "text"
  | "number"
  | "temperature"
  | "multipleChoice"
  | "date"
  | "photo"
  | "signature"
  | "instruction";

const TYPES: { value: QType; label: string }[] = [
  { value: "passFailNA", label: "Pass / Fail / N/A" },
  { value: "checkbox", label: "Yes / No" },
  { value: "multipleChoice", label: "Multiple choice" },
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "temperature", label: "Temperature" },
  { value: "date", label: "Date" },
  { value: "photo", label: "Photo" },
  { value: "signature", label: "Signature" },
  { value: "instruction", label: "Instruction (no answer)" },
];

type BuilderQuestion = {
  id: string;
  label: string;
  type: QType;
  required: boolean;
  requireNote: boolean;
  requirePhoto: boolean;
  options: string; // comma-separated in the builder
  unit: string;
};
type BuilderSection = { id: string; title: string; questions: BuilderQuestion[] };

let counter = 0;
const uid = (p: string) => `${p}_${Date.now().toString(36)}_${counter++}`;

const newQuestion = (): BuilderQuestion => ({
  id: uid("q"),
  label: "",
  type: "passFailNA",
  required: false,
  requireNote: false,
  requirePhoto: false,
  options: "",
  unit: "",
});
const newSection = (title = "Section"): BuilderSection => ({
  id: uid("s"),
  title,
  questions: [newQuestion()],
});

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || "form";

const hasOptions = (t: QType) => t === "multipleChoice";
const hasUnit = (t: QType) => t === "number" || t === "temperature";

export default function NewTemplatePage() {
  const me = useBeacon();
  const router = useRouter();
  const create = useMutation(api.templates.create);

  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [industry, setIndustry] = useState("construction");
  const [scoring, setScoring] = useState(true);
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const [sections, setSections] = useState<BuilderSection[]>([newSection("Details")]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patchSection = (sid: string, patch: Partial<BuilderSection>) =>
    setSections((ss) => ss.map((s) => (s.id === sid ? { ...s, ...patch } : s)));
  const patchQuestion = (sid: string, qid: string, patch: Partial<BuilderQuestion>) =>
    setSections((ss) =>
      ss.map((s) =>
        s.id === sid
          ? {
              ...s,
              questions: s.questions.map((q) =>
                q.id === qid ? { ...q, ...patch } : q,
              ),
            }
          : s,
      ),
    );

  const questionCount = sections.reduce(
    (n, s) => n + s.questions.filter((q) => q.type !== "instruction").length,
    0,
  );

  const onSave = async () => {
    setError(null);
    if (!me?.orgId) return;
    if (!name.trim()) return setError("Give the form a name.");
    const cleaned = sections
      .map((s) => ({
        id: s.id,
        title: s.title.trim() || "Section",
        questions: s.questions
          .filter((q) => q.label.trim())
          .map((q) => ({
            id: q.id,
            label: q.label.trim(),
            type: q.type,
            required: q.required || undefined,
            requireNote: q.requireNote || undefined,
            requirePhoto: q.requirePhoto || undefined,
            unit: hasUnit(q.type) && q.unit.trim() ? q.unit.trim() : undefined,
            options: hasOptions(q.type)
              ? q.options
                  .split(",")
                  .map((o) => o.trim())
                  .filter(Boolean)
                  .map((label) => ({ label }))
              : undefined,
          })),
      }))
      .filter((s) => s.questions.length > 0);
    if (cleaned.length === 0)
      return setError("Add at least one question with a label.");

    setSaving(true);
    try {
      const id = await create({
        orgId: me.orgId,
        key: `${slug(industry)}.${slug(name)}.${Date.now().toString(36)}`,
        name: name.trim(),
        category: category.trim() || "Inspection",
        industry: industry.trim() || "general",
        sections: cleaned,
        scoringEnabled: scoring,
        visibility,
        createdBy: me.userId ?? undefined,
      });
      router.push(`/office/templates/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the form.");
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <Link
        href="/office/templates"
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-neutral-900"
      >
        <ChevronLeft className="h-4 w-4" /> Form library
      </Link>

      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="font-montserrat text-2xl font-bold tracking-tight">
            New form
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {questionCount} answerable question{questionCount === 1 ? "" : "s"} ·
            saved to your org{visibility === "public" ? " and shared publicly" : ""}.
          </p>
        </div>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save form"}
        </button>
      </header>

      {error && (
        <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-inset ring-rose-600/20">
          {error}
        </p>
      )}

      {/* Meta */}
      <section className="mb-6 rounded-xl border border-border bg-white p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Form name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Scaffold Daily Check"
              className="input"
            />
          </Field>
          <Field label="Category">
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. Plant pre-start"
              className="input"
            />
          </Field>
          <Field label="Industry">
            <input
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              placeholder="construction"
              className="input"
            />
          </Field>
          <Field label="Scoring">
            <label className="flex h-10 items-center gap-2 text-sm text-neutral-700">
              <input
                type="checkbox"
                checked={scoring}
                onChange={(e) => setScoring(e.target.checked)}
                className="h-4 w-4 accent-neutral-900"
              />
              Score Pass/Fail answers
            </label>
          </Field>
        </div>

        <div className="mt-4">
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Visibility
          </p>
          <div className="inline-flex overflow-hidden rounded-lg border border-border">
            {(["private", "public"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setVisibility(v)}
                className={`px-4 py-2 text-sm font-medium ${
                  visibility === v
                    ? "bg-neutral-900 text-white"
                    : "bg-white text-neutral-600 hover:bg-neutral-50"
                }`}
              >
                {v === "private" ? "Private (this org)" : "Public (shared library)"}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Sections */}
      <div className="space-y-4">
        {sections.map((section, si) => (
          <section
            key={section.id}
            className="rounded-xl border border-border bg-white"
          >
            <div className="flex items-center gap-3 border-b border-border bg-neutral-50 px-4 py-3">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-neutral-900 text-xs font-semibold text-white">
                {si + 1}
              </span>
              <input
                value={section.title}
                onChange={(e) => patchSection(section.id, { title: e.target.value })}
                className="flex-1 bg-transparent font-medium text-neutral-900 outline-none"
                placeholder="Section title"
              />
              {sections.length > 1 && (
                <button
                  type="button"
                  onClick={() =>
                    setSections((ss) => ss.filter((s) => s.id !== section.id))
                  }
                  className="text-muted-foreground hover:text-rose-600"
                  aria-label="Remove section"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>

            <div className="divide-y divide-border">
              {section.questions.map((q) => (
                <div key={q.id} className="px-4 py-3.5">
                  <div className="flex items-start gap-2">
                    <GripVertical className="mt-2.5 h-4 w-4 shrink-0 text-neutral-300" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap gap-2">
                        <input
                          value={q.label}
                          onChange={(e) =>
                            patchQuestion(section.id, q.id, { label: e.target.value })
                          }
                          placeholder="Question label"
                          className="input min-w-0 flex-1"
                        />
                        <select
                          value={q.type}
                          onChange={(e) =>
                            patchQuestion(section.id, q.id, {
                              type: e.target.value as QType,
                            })
                          }
                          className="input w-auto"
                        >
                          {TYPES.map((t) => (
                            <option key={t.value} value={t.value}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      {hasOptions(q.type) && (
                        <input
                          value={q.options}
                          onChange={(e) =>
                            patchQuestion(section.id, q.id, { options: e.target.value })
                          }
                          placeholder="Options, comma-separated (e.g. Clear, Wet, Icy)"
                          className="input"
                        />
                      )}
                      {hasUnit(q.type) && (
                        <input
                          value={q.unit}
                          onChange={(e) =>
                            patchQuestion(section.id, q.id, { unit: e.target.value })
                          }
                          placeholder="Unit (e.g. °C, psi, m)"
                          className="input w-40"
                        />
                      )}

                      {q.type !== "instruction" && (
                        <div className="flex flex-wrap gap-4 text-[13px] text-neutral-600">
                          <Toggle
                            checked={q.required}
                            onChange={(v) =>
                              patchQuestion(section.id, q.id, { required: v })
                            }
                            label="Required"
                          />
                          <Toggle
                            checked={q.requireNote}
                            onChange={(v) =>
                              patchQuestion(section.id, q.id, { requireNote: v })
                            }
                            label="Require note"
                          />
                          <Toggle
                            checked={q.requirePhoto}
                            onChange={(v) =>
                              patchQuestion(section.id, q.id, { requirePhoto: v })
                            }
                            label="Require evidence"
                          />
                        </div>
                      )}
                    </div>
                    {section.questions.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          patchSection(section.id, {
                            questions: section.questions.filter((x) => x.id !== q.id),
                          })
                        }
                        className="mt-1.5 text-muted-foreground hover:text-rose-600"
                        aria-label="Remove question"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="px-4 py-3">
              <button
                type="button"
                onClick={() =>
                  patchSection(section.id, {
                    questions: [...section.questions, newQuestion()],
                  })
                }
                className="inline-flex items-center gap-1.5 text-sm font-medium text-neutral-700 hover:text-neutral-900"
              >
                <Plus className="h-4 w-4" /> Add question
              </button>
            </div>
          </section>
        ))}

        <button
          type="button"
          onClick={() => setSections((ss) => [...ss, newSection()])}
          className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-4 py-2.5 text-sm font-medium text-neutral-600 hover:bg-neutral-50"
        >
          <Plus className="h-4 w-4" /> Add section
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="inline-flex items-center gap-1.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-neutral-900"
      />
      {label}
    </label>
  );
}

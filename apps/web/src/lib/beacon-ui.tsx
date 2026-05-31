import type { ReactNode } from "react";

/** Inspection lifecycle → label + color. Calm office palette, one accent per state. */
const STATUS_STYLES: Record<string, { label: string; cls: string }> = {
  in_progress: {
    label: "In progress",
    cls: "bg-amber-50 text-amber-700 ring-amber-600/20",
  },
  completed: {
    label: "Completed",
    cls: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  },
  submitted: {
    label: "Submitted",
    cls: "bg-sky-50 text-sky-700 ring-sky-600/20",
  },
};

export function StatusPill({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? {
    label: status,
    cls: "bg-neutral-100 text-neutral-600 ring-neutral-500/20",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${s.cls}`}
    >
      {s.label}
    </span>
  );
}

/** A completed inspection's score, color-graded by the usual safety thresholds. */
export function ScoreBadge({ score }: { score?: number }) {
  if (score === undefined || score === null)
    return <span className="text-sm text-muted-foreground">—</span>;
  const tone =
    score >= 90
      ? "text-emerald-600"
      : score >= 70
        ? "text-amber-600"
        : "text-rose-600";
  return (
    <span className={`text-sm font-semibold tabular-nums ${tone}`}>
      {Math.round(score)}%
    </span>
  );
}

/** Human label for a question's question-type (used in the read-only template view). */
const TYPE_LABELS: Record<string, string> = {
  instruction: "Instruction",
  passFailNA: "Pass / Fail / N/A",
  question: "Pass / Fail / N/A",
  text: "Text",
  number: "Number",
  temperature: "Temperature",
  multipleChoice: "Multiple choice",
  checkbox: "Checkbox",
  date: "Date",
  datetime: "Date & time",
  signature: "Signature",
  photo: "Photo",
  slider: "Slider",
  list: "Select from list",
};

export function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type;
}

/** Render a recorded answer value as readable text for the office views. */
export function formatAnswer(value: unknown): ReactNode {
  if (value === undefined || value === null || value === "")
    return <span className="text-muted-foreground">Not answered</span>;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

export function formatDate(ts?: number): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

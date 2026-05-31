// Pure scoring & fail-detection helpers (no Convex imports — easy to unit test).
// Operates on a stored template version's `sections` plus an inspection's `responses`.
import type { Question, Section } from "../templatePacks/types";

export interface ResponseInput {
  questionId: string;
  value?: unknown;
  flagged?: boolean;
}

/** Flatten visible questions out of sections. */
function allQuestions(sections: Section[]): Question[] {
  return sections.flatMap((s) => s.questions);
}

/** Did this response fail / breach / flag the question? */
export function isFailed(q: Question, value: unknown, flagged?: boolean): boolean {
  if (flagged === true) return true;
  if (value === undefined || value === null || value === "") return false;

  switch (q.type) {
    case "passFailNA":
      return value === "fail";
    case "question": // SafetyCulture response-set question (Yes / No / N/A)
      return value === "no";
    case "temperature":
    case "number":
    case "slider": {
      const n = typeof value === "number" ? value : Number(value);
      if (Number.isNaN(n)) return false;
      if (q.min !== undefined && n < q.min) return true;
      if (q.max !== undefined && n > q.max) return true;
      return false;
    }
    case "multipleChoice": {
      const opt = q.options?.find((o) => o.label === value);
      return opt?.flag === true;
    }
    case "checkbox": {
      const selected = Array.isArray(value) ? (value as string[]) : [value as string];
      return (q.options ?? []).some((o) => o.flag === true && selected.includes(o.label));
    }
    default:
      return false;
  }
}

/** Points earned / possible for a single scorable question (weight-aware). */
function questionScore(q: Question, value: unknown): { earned: number; possible: number } | null {
  const weight = q.weight ?? 1;
  switch (q.type) {
    case "passFailNA": {
      if (value === "na" || value === undefined) return null; // excluded
      return { earned: value === "pass" ? weight : 0, possible: weight };
    }
    case "question": {
      if (value === "na" || value === undefined) return null; // excluded
      return { earned: value === "yes" ? weight : 0, possible: weight };
    }
    case "multipleChoice": {
      const scored = q.options?.some((o) => o.score !== undefined);
      if (!scored) return null;
      const max = Math.max(...(q.options ?? []).map((o) => o.score ?? 0), 0);
      const opt = q.options?.find((o) => o.label === value);
      if (max <= 0) return null;
      return { earned: weight * (opt?.score ?? 0), possible: weight * max };
    }
    default:
      return null;
  }
}

export interface ScoreResult {
  /** 0–100 percent, or undefined if nothing scorable was answered. */
  score?: number;
  flaggedQuestionIds: string[];
  /** Questions that failed AND are configured to auto-create a corrective action. */
  failedTriggers: { id: string; label: string }[];
}

export function computeScore(sections: Section[], responses: ResponseInput[]): ScoreResult {
  const byId = new Map(responses.map((r) => [r.questionId, r]));
  let earned = 0;
  let possible = 0;
  const flaggedQuestionIds: string[] = [];
  const failedTriggers: { id: string; label: string }[] = [];

  for (const q of allQuestions(sections)) {
    const r = byId.get(q.id);
    const value = r?.value;
    const failed = isFailed(q, value, r?.flagged);
    if (failed) {
      flaggedQuestionIds.push(q.id);
      if (q.triggersActionOnFail) failedTriggers.push({ id: q.id, label: q.label });
    }
    const qs = questionScore(q, value);
    if (qs) {
      earned += qs.earned;
      possible += qs.possible;
    }
  }

  const score = possible > 0 ? Math.round((earned / possible) * 100) : undefined;
  return { score, flaggedQuestionIds, failedTriggers };
}

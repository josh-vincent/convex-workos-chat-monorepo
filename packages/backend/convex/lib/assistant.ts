/**
 * Pure helpers for the inspection assistant (no Convex/runtime deps), so they
 * can be unit-tested deterministically without a model or the gateway.
 */

// Chat models, routed through the Vercel AI Gateway (AI SDK v5).
export const HAIKU_MODEL = process.env.CHAT_MODEL ?? "anthropic/claude-haiku-4.5";
export const SONNET_MODEL = "anthropic/claude-sonnet-4.6";

type MessageLike = { parts?: { type?: string }[] };

/** True when any message carries an image/file part — those route to Sonnet (vision). */
export function hasImageContent(messages: MessageLike[]): boolean {
  return messages.some((m) =>
    m.parts?.some((p) => {
      const t = p?.type ?? "";
      return t === "file" || t === "image";
    }),
  );
}

/** Haiku by default; Sonnet when the turn carries an image/attachment (vision). */
export function selectAssistantModel(messages: MessageLike[]): string {
  return hasImageContent(messages) ? SONNET_MODEL : HAIKU_MODEL;
}

/** WMO weather codes → short human label (Open-Meteo). */
export function weatherLabel(code: number): string {
  if (code === 0) return "Clear";
  if (code <= 3) return "Partly cloudy";
  if (code <= 48) return "Fog";
  if (code <= 57) return "Drizzle";
  if (code <= 67) return "Rain";
  if (code <= 77) return "Snow";
  if (code <= 82) return "Rain showers";
  if (code <= 86) return "Snow showers";
  if (code <= 99) return "Thunderstorm";
  return "Unknown";
}

type OutstandingQuestion = {
  id: string;
  label: string;
  type: string;
  required?: boolean;
  visibleWhen?: { questionId: string; equals?: string; notEquals?: string };
};
type OutstandingSection = { questions: OutstandingQuestion[] };
type OutstandingResponse = { questionId: string; value?: unknown };

/**
 * Compute the required questions that are still unanswered, respecting
 * conditional visibility (`visibleWhen`). Drives the assistant's
 * "prompt for what's still needed" loop — and proves it never claims a form is
 * done while required fields are blank.
 */
export function computeOutstanding(
  sections: OutstandingSection[],
  responses: OutstandingResponse[],
): {
  outstanding: { id: string; label: string; type: string }[];
  count: number;
  allDone: boolean;
} {
  const answered = new Set(
    responses
      .filter((r) => r.value !== undefined && r.value !== null && r.value !== "")
      .map((r) => r.questionId),
  );
  const answerByQid = new Map(responses.map((r) => [r.questionId, r.value]));
  const skipTypes = new Set(["instruction"]);
  const outstanding: { id: string; label: string; type: string }[] = [];
  for (const section of sections) {
    for (const q of section.questions) {
      if (!q.required || skipTypes.has(q.type)) continue;
      if (q.visibleWhen) {
        const dep = answerByQid.get(q.visibleWhen.questionId);
        if (q.visibleWhen.equals !== undefined && String(dep) !== q.visibleWhen.equals)
          continue;
        if (q.visibleWhen.notEquals !== undefined && String(dep) === q.visibleWhen.notEquals)
          continue;
      }
      if (!answered.has(q.id))
        outstanding.push({ id: q.id, label: q.label, type: q.type });
    }
  }
  return { outstanding, count: outstanding.length, allDone: outstanding.length === 0 };
}

type ContextAnswerQuestion = { id: string; label: string; type: string };
type ContextAnswerSection = { questions: ContextAnswerQuestion[] };

/**
 * Map tool-derived context (GPS address + weather) onto the form's site and
 * weather/conditions questions. These are legitimately recordable (a tool
 * produced them) — unlike subjective checks, which the assistant must ask about.
 * Used by the no-key demo assistant and reusable by the live path.
 */
export function pickContextAnswers(
  sections: ContextAnswerSection[],
  context: { address?: string; condition?: string; temperatureC?: number },
): { questionId: string; value: string }[] {
  const out: { questionId: string; value: string }[] = [];
  const weatherValue =
    context.condition && context.temperatureC != null
      ? `${context.condition}, ${Math.round(context.temperatureC)}°C`
      : context.condition;
  for (const section of sections) {
    for (const q of section.questions) {
      if (q.type === "instruction") continue;
      const label = q.label.toLowerCase();
      if (/weather|conditions|ground/.test(label) && weatherValue) {
        out.push({ questionId: q.id, value: weatherValue });
      } else if (/\bsite\b|location/.test(label) && context.address) {
        out.push({ questionId: q.id, value: context.address });
      }
    }
  }
  return out;
}

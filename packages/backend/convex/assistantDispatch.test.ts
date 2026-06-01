// @vitest-environment node
/**
 * Dispatch smoke test for the assistant — runs the REAL AI SDK `streamText`
 * tool loop with a scripted MockLanguageModelV2 (no network) to prove the
 * model's tool calls are parsed and routed into our tools with the right args.
 *
 * Why a separate file with `@vitest-environment node`: the rest of the suite runs
 * in "edge-runtime" (required by convex-test), where streamText's streaming loop
 * never drains. In node it runs normally. Convex is NOT available here, so we
 * pass a fake ctx and assert the tool calls the right mutation with the right
 * shape — DB-effect coverage lives in assistant.test.ts (edge-runtime).
 */
import { beforeAll, describe, expect, test, vi } from "vitest";
import { streamText, stepCountIs } from "ai";
import { MockLanguageModelV2, simulateReadableStream } from "ai/test";
import { assistantTools } from "./http";

// The global setup (vitest.setup.ts) freezes timers for retention tests, but
// simulateReadableStream relies on real setTimeout to emit chunks — restore them.
beforeAll(() => {
  vi.useRealTimers();
});

const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };

/** Mock model: step 1 calls setAnswer(q_pass='pass'), step 2 finishes with text. */
function scriptedModel(steps: { onStep?: (n: number) => void } = {}) {
  let step = 0;
  return new MockLanguageModelV2({
    doStream: async () => {
      step += 1;
      steps.onStep?.(step);
      const chunks =
        step === 1
          ? [
              { type: "stream-start", warnings: [] },
              {
                type: "tool-call",
                toolCallId: "c1",
                toolName: "setAnswer",
                input: JSON.stringify({ questionId: "q_pass", value: "pass" }),
              },
              { type: "finish", finishReason: "tool-calls", usage },
            ]
          : [
              { type: "stream-start", warnings: [] },
              { type: "text-start", id: "x" },
              {
                type: "text-delta",
                id: "x",
                delta: "Recorded brakes = pass. What's the Notes field?",
              },
              { type: "text-end", id: "x" },
              { type: "finish", finishReason: "stop", usage },
            ];
      return {
        stream: simulateReadableStream({
          chunks: chunks as never,
          initialDelayInMs: 0,
          chunkDelayInMs: 0,
        }),
      };
    },
  });
}

function fakeCtx() {
  return {
    runQuery: vi.fn(async () => null),
    runMutation: vi.fn(async () => ({ ok: true })),
    storage: { get: vi.fn(), getUrl: vi.fn() },
    auth: { getUserIdentity: vi.fn(async () => ({ subject: "u", email: "e" })) },
  };
}

describe("streamText dispatch (node env, mock model + fake ctx)", () => {
  test("a model tool-call is parsed and routed to setAnswer with correct args", async () => {
    const ctx = fakeCtx();
    let steps = 0;
    const model = scriptedModel({ onStep: (n) => (steps = n) });
    const tools = assistantTools(ctx as never, "insp123" as never, {});

    const result = streamText({
      model: model as never,
      prompt: "Brakes are good.",
      tools: tools as never,
      stopWhen: stepCountIs(5),
    });
    await result.consumeStream();
    const text = await result.text;

    // The loop actually ran (tool step → follow-up step).
    expect(steps).toBeGreaterThanOrEqual(2);
    expect(text).toContain("Notes");

    // setAnswer fired exactly once, routed to inspections.setAnswer with the
    // model's args + the default inspectionId (no fabricated extra calls).
    expect(ctx.runMutation).toHaveBeenCalledTimes(1);
    const callArgs = ctx.runMutation.mock.calls[0][1];
    expect(callArgs).toMatchObject({
      inspectionId: "insp123",
      questionId: "q_pass",
      value: "pass",
    });
  });
});

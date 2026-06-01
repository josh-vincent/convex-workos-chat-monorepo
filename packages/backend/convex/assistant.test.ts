/**
 * Tests for the AI inspection assistant.
 *
 * Three layers, none needing the real AI Gateway:
 *  1. Pure helpers (model routing, weather labels, outstanding-required logic).
 *  2. Tool integration — each tool's `execute` run against the simulated Convex
 *     DB (the test plays the model's role deterministically), proving the tools
 *     the model calls do the right thing and NEVER fabricate.
 *  3. Agent-loop simulation — drive the exact tool sequence the model would for a
 *     partial voice/chat update, asserting only-stated answers persist, the
 *     assistant knows what's still outstanding, and the form is never finished
 *     while required fields are blank.
 *
 * Constraints (CLAUDE.md): convex-test cannot run components, so we never call
 * inspections.complete / aggregates / workflows here. (We also avoid driving the
 * real streamText loop over t.fetch — its streaming response deadlocks under the
 * convex-test scheduler; the tool layer above is the unit under test anyway.)
 */
import { convexTest } from "convex-test";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { streamText, stepCountIs } from "ai";
import { MockLanguageModelV2, simulateReadableStream } from "ai/test";
import schema from "./schema";
import { api } from "./_generated/api";
import { assistantTools } from "./http";
import {
  HAIKU_MODEL,
  SONNET_MODEL,
  computeOutstanding,
  hasImageContent,
  selectAssistantModel,
  weatherLabel,
} from "./lib/assistant";

const modules = import.meta.glob(
  ["./**/*.ts", "./**/*.tsx", "!./components.ts", "!./workflows.ts", "!./reports.tsx"],
  { eager: false },
);

// Minimal ToolExecutionOptions for calling a tool's execute() directly.
const toolOpts = { toolCallId: "test", messages: [] } as never;

// A small template with a required pass/fail, a required note, and an
// instruction (which must never count as outstanding).
const SECTIONS = [
  {
    id: "s1",
    title: "Checks",
    questions: [
      { id: "q_instr", label: "Read the SWMS", type: "instruction" },
      { id: "q_pass", label: "Brakes operational", type: "passFailNA", required: true },
      { id: "q_note", label: "Notes", type: "text", required: true },
    ],
  },
];

async function seedInspection(t: ReturnType<typeof convexTest>) {
  const orgId = await t.run((ctx) =>
    ctx.db.insert("organizations", { name: "AI Org", slug: "ai-test-org", plan: "free" }),
  );
  const userId = await t.run((ctx) =>
    ctx.db.insert("users", {
      orgId: orgId as never,
      name: "Tech",
      authMethod: "email" as never,
    }),
  );
  const templateId = await t.mutation(api.templates.create, {
    orgId,
    key: "test.brakes.1",
    name: "Brake Check",
    category: "Plant",
    industry: "construction",
    sections: SECTIONS as never,
    scoringEnabled: false,
  });
  const inspectionId = await t.mutation(api.inspections.start, {
    orgId,
    templateId,
    inspectorId: userId,
  });
  return { orgId, userId, templateId, inspectionId };
}

// ---------------------------------------------------------------------------
// 1. Pure helpers
// ---------------------------------------------------------------------------
describe("assistant pure helpers", () => {
  test("hasImageContent detects image/file parts", () => {
    expect(hasImageContent([{ parts: [{ type: "text" }] }])).toBe(false);
    expect(hasImageContent([{ parts: [{ type: "file" }] }])).toBe(true);
    expect(hasImageContent([{ parts: [{ type: "image" }] }])).toBe(true);
    expect(hasImageContent([{}])).toBe(false);
  });

  test("selectAssistantModel routes images to Sonnet, text to Haiku", () => {
    expect(selectAssistantModel([{ parts: [{ type: "text" }] }])).toBe(HAIKU_MODEL);
    expect(selectAssistantModel([{ parts: [{ type: "image" }] }])).toBe(SONNET_MODEL);
  });

  test("weatherLabel maps WMO codes", () => {
    expect(weatherLabel(0)).toBe("Clear");
    expect(weatherLabel(3)).toBe("Partly cloudy");
    expect(weatherLabel(95)).toBe("Thunderstorm");
  });

  test("computeOutstanding lists required-unanswered, skips instruction", () => {
    const r = computeOutstanding(SECTIONS, []);
    expect(r.allDone).toBe(false);
    expect(r.outstanding.map((o) => o.id).sort()).toEqual(["q_note", "q_pass"]);
    expect(r.outstanding.find((o) => o.id === "q_instr")).toBeUndefined();
  });

  test("computeOutstanding removes answered, reports allDone", () => {
    const partial = computeOutstanding(SECTIONS, [{ questionId: "q_pass", value: "pass" }]);
    expect(partial.outstanding.map((o) => o.id)).toEqual(["q_note"]);
    const done = computeOutstanding(SECTIONS, [
      { questionId: "q_pass", value: "pass" },
      { questionId: "q_note", value: "all good" },
    ]);
    expect(done.allDone).toBe(true);
  });

  test("computeOutstanding respects visibleWhen (hidden required not counted)", () => {
    const sections = [
      {
        id: "s",
        title: "x",
        questions: [
          { id: "base", label: "Damaged?", type: "passFailNA", required: true },
          {
            id: "followup",
            label: "Describe damage",
            type: "text",
            required: true,
            visibleWhen: { questionId: "base", equals: "fail" },
          },
        ],
      },
    ];
    // base answered "pass" → followup hidden → only base-less set is empty, followup not required-visible
    const r = computeOutstanding(sections, [{ questionId: "base", value: "pass" }]);
    expect(r.allDone).toBe(true);
    // base answered "fail" → followup becomes visible + outstanding
    const r2 = computeOutstanding(sections, [{ questionId: "base", value: "fail" }]);
    expect(r2.outstanding.map((o) => o.id)).toEqual(["followup"]);
  });
});

// ---------------------------------------------------------------------------
// 2. Tool integration (tools run against the simulated DB)
// ---------------------------------------------------------------------------
describe("assistant tools", () => {
  test("getOutstandingRequired reflects the seeded form", async () => {
    const t = convexTest(schema, modules);
    const { inspectionId } = await seedInspection(t);
    const out = await t.action(async (ctx) => {
      const tools = assistantTools(ctx, inspectionId as never, {}) as never as Record<
        string,
        { execute: (a: unknown, o: unknown) => Promise<unknown> }
      >;
      return tools.getOutstandingRequired.execute({}, toolOpts);
    });
    expect(out).toMatchObject({ allDone: false });
    expect(
      (out as { outstanding: { id: string }[] }).outstanding.map((o) => o.id).sort(),
    ).toEqual(["q_note", "q_pass"]);
  });

  test("setAnswer records ONLY the stated value (no fabrication)", async () => {
    const t = convexTest(schema, modules);
    const { inspectionId } = await seedInspection(t);
    await t.action(async (ctx) => {
      const tools = assistantTools(ctx, inspectionId as never, {}) as never as Record<
        string,
        { execute: (a: unknown, o: unknown) => Promise<unknown> }
      >;
      await tools.setAnswer.execute(
        { questionId: "q_pass", value: "pass" },
        toolOpts,
      );
    });
    // Exactly one response persisted — the one we set.
    const insp = await t.run((ctx) => ctx.db.get(inspectionId as never));
    const responses = (insp as { responses: { questionId: string; value: unknown }[] })
      .responses;
    expect(responses).toHaveLength(1);
    expect(responses[0]).toMatchObject({ questionId: "q_pass", value: "pass" });
    // And the note is still outstanding.
    const out = await t.action(async (ctx) => {
      const tools = assistantTools(ctx, inspectionId as never, {}) as never as Record<
        string,
        { execute: (a: unknown, o: unknown) => Promise<unknown> }
      >;
      return tools.getOutstandingRequired.execute({}, toolOpts);
    });
    expect((out as { outstanding: { id: string }[] }).outstanding.map((o) => o.id)).toEqual([
      "q_note",
    ]);
  });

  test("getCurrentLocation / getCurrentDateTime echo device context", async () => {
    const t = convexTest(schema, modules);
    const loc = await t.action(async (ctx) => {
      const tools = assistantTools(ctx, undefined, {
        location: { lat: -37.8, lng: 144.96, address: "Melbourne VIC" },
        deviceTime: "2026-05-31T09:00:00.000Z",
      }) as never as Record<string, { execute: (a: unknown, o: unknown) => Promise<unknown> }>;
      return {
        location: await tools.getCurrentLocation.execute({}, toolOpts),
        time: await tools.getCurrentDateTime.execute({}, toolOpts),
      };
    });
    expect(loc.location).toMatchObject({ lat: -37.8, lng: 144.96, address: "Melbourne VIC" });
    expect(loc.time).toMatchObject({ iso: "2026-05-31T09:00:00.000Z" });
  });

  test("getCurrentLocation errors gracefully without GPS", async () => {
    const t = convexTest(schema, modules);
    const res = await t.action(async (ctx) => {
      const tools = assistantTools(ctx, undefined, {}) as never as Record<
        string,
        { execute: (a: unknown, o: unknown) => Promise<unknown> }
      >;
      return tools.getCurrentLocation.execute({}, toolOpts);
    });
    expect(res).toHaveProperty("error");
  });

  test("getWeather parses Open-Meteo (mocked fetch)", async () => {
    const t = convexTest(schema, modules);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            current: {
              temperature_2m: 14.2,
              weather_code: 3,
              wind_speed_10m: 11,
              relative_humidity_2m: 70,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const res = await t.action(async (ctx) => {
      const tools = assistantTools(ctx, undefined, {}) as never as Record<
        string,
        { execute: (a: unknown, o: unknown) => Promise<unknown> }
      >;
      return tools.getWeather.execute({ lat: -37.8, lng: 144.96 }, toolOpts);
    });
    expect(res).toMatchObject({ temperatureC: 14.2, condition: "Partly cloudy" });
  });

  test("lookupAsset resolves a QR code", async () => {
    const t = convexTest(schema, modules);
    // me.current resolves the demo org by slug "northwind" + user by email.
    const orgId = await t.run((ctx) =>
      ctx.db.insert("organizations", { name: "Northwind", slug: "northwind", plan: "free" }),
    );
    await t.run((ctx) =>
      ctx.db.insert("users", {
        orgId: orgId as never,
        name: "Tech",
        email: "tech@northwind.test",
        authMethod: "email" as never,
      }),
    );
    await t.run((ctx) =>
      ctx.db.insert("assets", {
        orgId: orgId as never,
        name: "Forklift 7",
        type: "forklift",
        qrCode: "FORK-7",
        status: "operational" as never,
      }),
    );
    const res = await t
      .withIdentity({ subject: "u1", email: "tech@northwind.test" })
      .action(async (ctx) => {
        const tools = assistantTools(ctx, undefined, {}) as never as Record<
          string,
          { execute: (a: unknown, o: unknown) => Promise<unknown> }
        >;
        return tools.lookupAsset.execute({ qrCode: "FORK-7" }, toolOpts);
      });
    expect(res).toMatchObject({ name: "Forklift 7", type: "forklift" });
  });
});

// ---------------------------------------------------------------------------
// 3. Agent-loop simulation — no-fabricate + prompt-for-missing, end to end
// ---------------------------------------------------------------------------
describe("assistant agent loop (no fabrication)", () => {
  test("a partial spoken update records only what was said and surfaces the rest", async () => {
    const t = convexTest(schema, modules);
    const { inspectionId } = await seedInspection(t);

    // The user "said": brakes are good. The model records ONLY that, then checks
    // what remains. It must NOT invent the Notes answer.
    const result = await t.action(async (ctx) => {
      const tools = assistantTools(ctx, inspectionId as never, {}) as never as Record<
        string,
        { execute: (a: unknown, o: unknown) => Promise<unknown> }
      >;
      // 1. read the form (what the model does first)
      await tools.getInspectionForm.execute({}, toolOpts);
      // 2. record only the stated answer
      await tools.setAnswer.execute({ questionId: "q_pass", value: "pass" }, toolOpts);
      // 3. find out what still needs the user
      return tools.getOutstandingRequired.execute({}, toolOpts);
    });

    // The form is not done, and the only thing missing is the field the user
    // never mentioned — nothing was fabricated to fill it.
    expect(result).toMatchObject({ allDone: false });
    expect(
      (result as { outstanding: { id: string }[] }).outstanding.map((o) => o.id),
    ).toEqual(["q_note"]);

    const insp = await t.run((ctx) => ctx.db.get(inspectionId as never));
    const responses = (insp as { responses: { questionId: string; value: unknown }[] })
      .responses;
    expect(responses).toHaveLength(1);
    expect(responses[0]).toMatchObject({ questionId: "q_pass", value: "pass" });
    expect((insp as { status: string }).status).not.toBe("completed");
  });

  test("once the user supplies the rest, the form reports allDone", async () => {
    const t = convexTest(schema, modules);
    const { inspectionId } = await seedInspection(t);
    const done = await t.action(async (ctx) => {
      const tools = assistantTools(ctx, inspectionId as never, {}) as never as Record<
        string,
        { execute: (a: unknown, o: unknown) => Promise<unknown> }
      >;
      await tools.setAnswer.execute({ questionId: "q_pass", value: "pass" }, toolOpts);
      await tools.setAnswer.execute(
        { questionId: "q_note", value: "All clear on walk-around." },
        toolOpts,
      );
      return tools.getOutstandingRequired.execute({}, toolOpts);
    });
    expect(done).toMatchObject({ allDone: true, count: 0 });
  });
});

// ---------------------------------------------------------------------------
// 4. Real streamText loop + real Convex DB, driven by a MOCK gateway model
// ---------------------------------------------------------------------------
// The end-to-end path: a scripted MockLanguageModelV2 (no network) drives the
// production streamText tool loop, whose tools write to the simulated Convex DB.
// Needs real timers (the global setup freezes them for retention tests, which
// would stall simulateReadableStream's chunk emission).
describe("streamText loop + Convex (mock gateway model)", () => {
  beforeAll(() => {
    vi.useRealTimers();
  });
  afterAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-06-01T00:00:00.000Z"));
  });

  test("records only the stated answer and never auto-completes", async () => {
    const t = convexTest(schema, modules);
    const { inspectionId } = await seedInspection(t);

    let step = 0;
    const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };
    const model = new MockLanguageModelV2({
      doStream: async () => {
        step += 1;
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
                  delta: "Recorded brakes = pass. I still need the Notes field.",
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

    const text = await t.action(async (ctx) => {
      const result = streamText({
        model: model as never,
        messages: [{ role: "user", content: "Brakes are good." }],
        tools: assistantTools(ctx, inspectionId as never, {}) as never,
        stopWhen: stepCountIs(40),
      });
      await result.consumeStream();
      return result.text;
    });

    expect(step).toBeGreaterThanOrEqual(2); // looped: tool call → follow-up
    expect(await text).toContain("Notes");

    const insp = await t.run((ctx) => ctx.db.get(inspectionId as never));
    const responses = (insp as { responses: { questionId: string; value: unknown }[] })
      .responses;
    expect(responses).toHaveLength(1);
    expect(responses[0]).toMatchObject({ questionId: "q_pass", value: "pass" });
    expect((insp as { status: string }).status).not.toBe("completed");
  });
});

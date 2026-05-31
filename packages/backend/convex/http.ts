import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { SignJWT, importPKCS8 } from "jose";
import {
  convertToModelMessages,
  streamText,
  stepCountIs,
  tool,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import { z } from "zod";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";

// Example tool the model can call when AI_GATEWAY_API_KEY is set.
const chatTools = {
  getWeather: tool({
    description: "Get the current weather for a city.",
    inputSchema: z.object({ city: z.string().describe("City name") }),
    execute: async ({ city }) => ({
      city,
      temperatureC: 18,
      condition: "Foggy",
    }),
  }),
};

/**
 * Mock "guest" auth endpoint.
 *
 * Mints a short-lived RS256 JWT signed with the dev keypair created by
 * `pnpm setup:mock-auth` (stored in Convex env). The token's issuer/audience
 * match the mock provider registered in auth.config.ts, so Convex verifies it
 * exactly like a real WorkOS access token.
 *
 * Clients send a stable `subject` (persisted per device) so refreshing a guest
 * token keeps the same user identity across reloads.
 */

const MOCK_ISSUER = process.env.MOCK_JWT_ISSUER ?? "https://guest.convex.local";
const TOKEN_TTL_SECONDS = 60 * 60; // 1 hour

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// Default chat model, routed through the Vercel AI Gateway (AI SDK v5).
const CHAT_MODEL = process.env.CHAT_MODEL ?? "anthropic/claude-haiku-4.5";

const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

const http = httpRouter();

http.route({
  path: "/guest-login",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { headers: corsHeaders })),
});

http.route({
  path: "/guest-login",
  method: "POST",
  handler: httpAction(async (_ctx, request) => {
    const privateKeyPem = process.env.MOCK_JWT_PRIVATE_KEY;
    if (!privateKeyPem) {
      return new Response(
        JSON.stringify({
          error:
            "Guest auth is not configured. Run `pnpm setup:mock-auth` to generate dev keys.",
        }),
        { status: 501, headers: jsonHeaders },
      );
    }

    let subject = `guest_${crypto.randomUUID()}`;
    try {
      const body = (await request.json()) as { subject?: unknown };
      if (
        typeof body?.subject === "string" &&
        body.subject.startsWith("guest_")
      ) {
        subject = body.subject;
      }
    } catch {
      // No/invalid body — fall back to a fresh guest identity.
    }

    // Stored base64-encoded (single-line) by setup-mock-auth; decode to PEM.
    const pem = privateKeyPem.includes("BEGIN")
      ? privateKeyPem
      : atob(privateKeyPem);
    const key = await importPKCS8(pem, "RS256");
    const kid = process.env.MOCK_JWT_KID ?? "mock-guest-key";
    const now = Math.floor(Date.now() / 1000);

    const token = await new SignJWT({
      name: "Guest User",
      email: `${subject}@guest.local`,
    })
      .setProtectedHeader({ alg: "RS256", kid })
      .setSubject(subject)
      .setIssuer(MOCK_ISSUER)
      .setAudience("convex")
      .setIssuedAt(now)
      .setExpirationTime(now + TOKEN_TTL_SECONDS)
      .sign(key);

    return new Response(
      JSON.stringify({ token, subject, expiresIn: TOKEN_TTL_SECONDS }),
      { headers: jsonHeaders },
    );
  }),
});

/**
 * Authenticated AI chat streaming endpoint.
 *
 * Verifies the caller's JWT (WorkOS or mock guest) via ctx.auth, then streams a
 * response. With AI_GATEWAY_API_KEY set, it streams from the Vercel AI Gateway
 * (AI SDK v5). Without a key, it streams a MOCKED response through the same UI
 * message-stream protocol — so the full client → Convex → stream pipeline can be
 * exercised end-to-end with no external dependency.
 */

// Streaming response headers (iOS NSURLSession needs these to stream).
// https://github.com/expo/expo/issues/32950#issuecomment-2508297646
const streamHeaders: Record<string, string> = {
  ...corsHeaders,
  "Content-Type": "application/octet-stream",
  "Content-Encoding": "none",
};

/** Extract the text of the most recent user message from a UIMessage list. */
function lastUserMessageText(messages: UIMessage[]): string {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUser) return "";
  return lastUser.parts
    .filter(
      (p): p is { type: "text"; text: string } =>
        p.type === "text" && typeof (p as { text?: unknown }).text === "string",
    )
    .map((p) => p.text)
    .join("")
    .slice(0, 200);
}

// --- Inspection-assist helpers ----------------------------------------------

type FormQuestion = {
  id: string;
  label: string;
  type: string;
  options?: { label: string; flag?: boolean }[];
  min?: number;
  max?: number;
};

/** Pick a sensible default answer for the scripted (offline) agent. */
function defaultAnswer(q: FormQuestion): unknown {
  switch (q.type) {
    case "passFailNA":
    case "question":
      return "pass";
    case "checkbox":
      return true;
    case "multipleChoice":
    case "list":
      return ((q.options ?? []).find((o) => !o.flag) ?? q.options?.[0])?.label;
    case "number":
    case "temperature":
    case "slider":
      return q.min != null && q.max != null
        ? Math.round((q.min + q.max) / 2)
        : (q.min ?? 0);
    case "date":
    case "datetime":
      return new Date().toISOString().slice(0, 10);
    case "text":
      return "OK — checked, no issues.";
    default:
      return undefined; // instruction / signature / photo / media / etc. — skip
  }
}

/** AI SDK tools the model uses to complete an inspection (real-model path). */
function inspectionTools(ctx: ActionCtx, inspectionId: Id<"inspections">) {
  return {
    getInspectionForm: tool({
      description:
        "Read the active inspection: questions (id, label, type, options) and answers so far.",
      inputSchema: z.object({}),
      execute: async () => {
        const f = await ctx.runQuery(api.inspections.get, { inspectionId });
        return f
          ? {
              name: f.templateName,
              sections: f.sections,
              responses: f.inspection.responses,
            }
          : { error: "not found" };
      },
    }),
    setAnswer: tool({
      description:
        "Record one answer by the question's id. value matches the type " +
        "(passFailNA: 'pass'|'fail'|'na'; checkbox: boolean; number/temperature: number; " +
        "multipleChoice/list: an option label; text/date: string).",
      inputSchema: z.object({
        questionId: z.string(),
        value: z.any(),
        note: z.string().optional(),
        flagged: z.boolean().optional(),
      }),
      execute: async ({ questionId, value, note, flagged }) => {
        await ctx.runMutation(api.inspections.setAnswer, {
          inspectionId,
          questionId,
          value,
          note,
          flagged,
        });
        return { ok: true };
      },
    }),
    completeInspection: tool({
      description: "Finish and score the inspection once questions are answered.",
      inputSchema: z.object({}),
      execute: async () =>
        await ctx.runMutation(api.inspections.complete, { inspectionId }),
    }),
  };
}

/** Scripted (offline) agent: fill the form via real mutations, narrating tool calls. */
async function scriptedFill(
  ctx: ActionCtx,
  inspectionId: Id<"inspections">,
  writer: { write: (chunk: UIMessageChunk) => void },
) {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const text = async (id: string, body: string) => {
    writer.write({ type: "text-start", id });
    for (const c of body.split(/(?<=\s)/)) {
      writer.write({ type: "text-delta", id, delta: c });
      await sleep(15);
    }
    writer.write({ type: "text-end", id });
  };

  const form = await ctx.runQuery(api.inspections.get, { inspectionId });
  if (!form) {
    await text("err", "I couldn't find that inspection.");
    return;
  }
  await text("intro", `On it — completing **${form.templateName}**.\n`);

  const c0 = "t_read";
  writer.write({ type: "tool-input-start", toolCallId: c0, toolName: "getInspectionForm" });
  writer.write({ type: "tool-input-available", toolCallId: c0, toolName: "getInspectionForm", input: {} });
  await sleep(300);
  const questions = (form.sections as { questions: FormQuestion[] }[]).flatMap(
    (s) => s.questions,
  );
  writer.write({ type: "tool-output-available", toolCallId: c0, output: { questions: questions.length } });

  let n = 0;
  for (const q of questions) {
    const value = defaultAnswer(q);
    if (value === undefined) continue;
    const cid = `t_set_${n++}`;
    writer.write({ type: "tool-input-start", toolCallId: cid, toolName: "setAnswer" });
    writer.write({
      type: "tool-input-available",
      toolCallId: cid,
      toolName: "setAnswer",
      input: { questionId: q.id, label: q.label, value },
    });
    await ctx.runMutation(api.inspections.setAnswer, {
      inspectionId,
      questionId: q.id,
      value,
    });
    await sleep(110);
    writer.write({ type: "tool-output-available", toolCallId: cid, output: { ok: true } });
  }

  const cc = "t_complete";
  writer.write({ type: "tool-input-start", toolCallId: cc, toolName: "completeInspection" });
  writer.write({ type: "tool-input-available", toolCallId: cc, toolName: "completeInspection", input: {} });
  const res = await ctx.runMutation(api.inspections.complete, { inspectionId });
  await sleep(300);
  writer.write({
    type: "tool-output-available",
    toolCallId: cc,
    output: { score: res.score, actionsCreated: res.actionsCreated },
  });
  await text(
    "outro",
    `\nDone — answered ${n} item(s), scored **${res.score ?? "—"}%**, created ${res.actionsCreated} corrective action(s).`,
  );
}

http.route({
  path: "/chat",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { headers: corsHeaders })),
});

http.route({
  path: "/chat",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: jsonHeaders,
      });
    }

    const body = (await request.json()) as {
      messages: UIMessage[];
      inspectionId?: string;
    };
    const messages = body.messages;
    const hasKey = !!process.env.AI_GATEWAY_API_KEY;

    // Inspection-assist mode: the technician is completing a form via chat.
    if (body.inspectionId) {
      const inspectionId = body.inspectionId as Id<"inspections">;
      if (hasKey) {
        const result = streamText({
          model: CHAT_MODEL,
          system:
            "You are a field safety assistant completing an inspection. Call " +
            "getInspectionForm to read the questions (ids + types), then setAnswer " +
            "for each (value must match the type), then completeInspection and report " +
            "the score. If the user describes findings, reflect them in the answers.",
          messages: convertToModelMessages(messages),
          tools: inspectionTools(ctx, inspectionId),
          stopWhen: stepCountIs(12),
        });
        return result.toUIMessageStreamResponse({ headers: streamHeaders });
      }
      const stream = createUIMessageStream({
        execute: async ({ writer }) => scriptedFill(ctx, inspectionId, writer),
      });
      return createUIMessageStreamResponse({ stream, headers: streamHeaders });
    }

    // No gateway key → stream a mocked reply over the real UI message protocol.
    if (!hasKey) {
      const lastUserText = lastUserMessageText(messages);
      const reply =
        `**Mocked reply** streamed from the Convex \`/chat\` action ` +
        `(no AI Gateway key needed).\n\n` +
        (lastUserText ? `You said: _${lastUserText}_\n\n` : "") +
        "Here's a tip:\n\n> Keep auth on the server and the UI dumb.\n\n" +
        "```ts\nconst answer = 42;\n```";

      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const streamText_ = async (
        writer: { write: (chunk: UIMessageChunk) => void },
        id: string,
        text: string,
      ) => {
        writer.write({ type: "text-start", id });
        for (const chunk of text.split(/(?<=\s)/)) {
          writer.write({ type: "text-delta", id, delta: chunk });
          await sleep(25);
        }
        writer.write({ type: "text-end", id });
      };

      const stream = createUIMessageStream({
        execute: async ({ writer }) => {
          await sleep(600); // simulate model latency (shows the "Thinking…" UI)
          await streamText_(writer, "intro", "Sure — let me check a couple of things.\n");

          // Tool 1: waiting → received
          const c1 = "call_weather";
          writer.write({ type: "tool-input-start", toolCallId: c1, toolName: "getWeather" });
          writer.write({
            type: "tool-input-available",
            toolCallId: c1,
            toolName: "getWeather",
            input: { city: "San Francisco" },
          });
          await sleep(1300); // visible "running" state
          writer.write({
            type: "tool-output-available",
            toolCallId: c1,
            output: { city: "San Francisco", temperatureC: 18, condition: "Foggy" },
          });

          // Tool 2: waiting → error
          const c2 = "call_order";
          writer.write({ type: "tool-input-start", toolCallId: c2, toolName: "lookupOrder" });
          writer.write({
            type: "tool-input-available",
            toolCallId: c2,
            toolName: "lookupOrder",
            input: { orderId: "ORD-404" },
          });
          await sleep(1300);
          writer.write({
            type: "tool-output-error",
            toolCallId: c2,
            errorText: "Order ORD-404 not found.",
          });

          await streamText_(
            writer,
            "outro",
            "\nThe weather call succeeded; the order lookup errored (demo). " + reply,
          );
        },
      });
      return createUIMessageStreamResponse({ stream, headers: streamHeaders });
    }

    const result = streamText({
      model: CHAT_MODEL,
      system: "You are a helpful, concise assistant.",
      messages: convertToModelMessages(messages),
      tools: chatTools,
    });

    return result.toUIMessageStreamResponse({ headers: streamHeaders });
  }),
});

export default http;

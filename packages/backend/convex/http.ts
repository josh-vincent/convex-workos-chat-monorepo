import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { SignJWT, importPKCS8 } from "jose";
import {
  convertToModelMessages,
  streamText,
  generateText,
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
import {
  SONNET_MODEL,
  selectAssistantModel,
  weatherLabel,
  computeOutstanding,
  pickContextAnswers,
} from "./lib/assistant";

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

// Models/helpers live in ./lib/assistant (pure, unit-tested). Haiku is the everyday
// driver; Sonnet is used when an image/attachment is in play (vision), and
// reviewPhotos always analyses with Sonnet internally.
const INSPECTION_MAX_STEPS = 40;

/** Per-request device context the client sends alongside messages. */
type DeviceContext = {
  location?: { lat: number; lng: number; address?: string };
  deviceTime?: string;
};

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

/**
 * The assistant's full tool set. Fill tools accept an optional `inspectionId`
 * (falling back to the one from the request body) so a session can start a new
 * inspection mid-conversation and immediately fill it. The assistant must only
 * record values the user stated or that a tool produced — never fabricate.
 * Exported so unit tests can drive each tool's `execute` directly.
 */
export function assistantTools(
  ctx: ActionCtx,
  defaultInspectionId: Id<"inspections"> | undefined,
  device: DeviceContext,
) {
  const resolveId = (arg?: string): Id<"inspections"> | null =>
    (arg as Id<"inspections"> | undefined) ?? defaultInspectionId ?? null;

  return {
    // --- Inspection fill ---------------------------------------------------
    getInspectionForm: tool({
      description:
        "Read an inspection: questions (id, label, type, required, options) and answers so far.",
      inputSchema: z.object({ inspectionId: z.string().optional() }),
      execute: async ({ inspectionId }) => {
        const id = resolveId(inspectionId);
        if (!id) return { error: "No inspection selected. Start one first." };
        const f = await ctx.runQuery(api.inspections.get, { inspectionId: id });
        return f
          ? {
              inspectionId: id,
              name: f.templateName,
              sections: f.sections,
              responses: f.inspection.responses,
            }
          : { error: "not found" };
      },
    }),
    setAnswer: tool({
      description:
        "Record ONE answer the user actually stated (or a tool produced). Never guess. " +
        "value matches the type (passFailNA/question: 'pass'|'fail'|'na'; checkbox: boolean; " +
        "number/temperature: number; multipleChoice/list: an option label; text/date: string; " +
        "controlMeasure: {hazard,riskRating,controlLevel,control}). Set flagged:true with a note " +
        "when the answer represents a failure or out-of-range reading.",
      inputSchema: z.object({
        inspectionId: z.string().optional(),
        questionId: z.string(),
        value: z.any(),
        note: z.string().optional(),
        flagged: z.boolean().optional(),
      }),
      execute: async ({ inspectionId, questionId, value, note, flagged }) => {
        const id = resolveId(inspectionId);
        if (!id) return { error: "No inspection selected." };
        await ctx.runMutation(api.inspections.setAnswer, {
          inspectionId: id,
          questionId,
          value,
          note,
          flagged,
        });
        return { ok: true };
      },
    }),
    getOutstandingRequired: tool({
      description:
        "List required questions still unanswered (respecting conditional visibility). " +
        "Call this after recording stated answers, then ask the user for what's left.",
      inputSchema: z.object({ inspectionId: z.string().optional() }),
      execute: async ({ inspectionId }) => {
        const id = resolveId(inspectionId);
        if (!id) return { error: "No inspection selected." };
        const f = await ctx.runQuery(api.inspections.get, { inspectionId: id });
        if (!f) return { error: "not found" };
        return computeOutstanding(
          f.sections as Parameters<typeof computeOutstanding>[0],
          f.inspection.responses as Parameters<typeof computeOutstanding>[1],
        );
      },
    }),
    completeInspection: tool({
      description:
        "Finish and score the inspection. ONLY call this once getOutstandingRequired returns " +
        "allDone AND the user has explicitly asked to submit/complete/finish.",
      inputSchema: z.object({ inspectionId: z.string().optional() }),
      execute: async ({ inspectionId }) => {
        const id = resolveId(inspectionId);
        if (!id) return { error: "No inspection selected." };
        return await ctx.runMutation(api.inspections.complete, { inspectionId: id });
      },
    }),
    reviewPhotos: tool({
      description:
        "Analyse photos already attached to the inspection for hazards, PPE compliance and " +
        "defects, and suggest answers. Use only when the user asks for a visual review.",
      inputSchema: z.object({
        inspectionId: z.string().optional(),
        maxPhotos: z.number().optional(),
      }),
      execute: async ({ inspectionId, maxPhotos }) => {
        const id = resolveId(inspectionId);
        if (!id) return { error: "No inspection selected." };
        const cap = Math.min(maxPhotos ?? 5, 10);
        const f = await ctx.runQuery(api.inspections.get, { inspectionId: id });
        if (!f) return { error: "not found" };
        const mediaIds: Id<"media">[] = [];
        for (const r of f.inspection.responses as { mediaIds?: Id<"media">[] }[]) {
          for (const m of r.mediaIds ?? []) {
            if (mediaIds.length >= cap) break;
            mediaIds.push(m);
          }
          if (mediaIds.length >= cap) break;
        }
        if (mediaIds.length === 0)
          return { findings: "No photos are attached to this inspection yet." };
        const rows = await ctx.runQuery(api.media.urls, { ids: mediaIds });
        const images: { type: "image"; image: Uint8Array; mediaType: string }[] = [];
        for (const row of rows) {
          if (!row.url || row.kind === "doc") continue;
          try {
            const res = await fetch(row.url);
            const buf = await res.arrayBuffer();
            if (buf.byteLength > 4_000_000) continue; // skip oversized
            images.push({
              type: "image",
              image: new Uint8Array(buf),
              mediaType: res.headers.get("content-type") ?? "image/jpeg",
            });
          } catch {
            /* skip unreadable blob */
          }
        }
        if (images.length === 0) return { findings: "Could not load the attached photos." };
        const { text: findings } = await generateText({
          model: SONNET_MODEL,
          messages: [
            {
              role: "user",
              content: [
                ...images,
                {
                  type: "text",
                  text:
                    `You are a safety inspection expert. Analyse these ${images.length} ` +
                    "inspection photo(s) and report, concisely: (1) visible hazards or " +
                    "non-compliance, (2) PPE status, (3) equipment defects/damage, " +
                    "(4) suggested pass/fail answers for likely questions. Do not invent " +
                    "details you cannot see.",
                },
              ],
            },
          ],
        });
        return { findings, photosAnalyzed: images.length };
      },
    }),

    // --- Device context ----------------------------------------------------
    getCurrentLocation: tool({
      description:
        "The device's current GPS coordinates and address (captured by the device for this request).",
      inputSchema: z.object({}),
      execute: async () =>
        device.location
          ? {
              lat: device.location.lat,
              lng: device.location.lng,
              address: device.location.address ?? null,
            }
          : { error: "Location unavailable — ask the user to enable location, or for the site." },
    }),
    getCurrentDateTime: tool({
      description: "The current date/time (ISO-8601) from the device clock. Use for date questions.",
      inputSchema: z.object({}),
      execute: async () => ({ iso: device.deviceTime ?? new Date().toISOString() }),
    }),
    getWeather: tool({
      description:
        "Real current weather for coordinates (get them from getCurrentLocation first).",
      inputSchema: z.object({ lat: z.number(), lng: z.number() }),
      execute: async ({ lat, lng }) => {
        try {
          const url =
            `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
            "&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m" +
            "&temperature_unit=celsius&wind_speed_unit=kmh";
          const res = await fetch(url);
          if (!res.ok) return { error: `Weather API error: ${res.status}` };
          const data = (await res.json()) as {
            current: {
              temperature_2m: number;
              weather_code: number;
              wind_speed_10m: number;
              relative_humidity_2m: number;
            };
          };
          return {
            temperatureC: data.current.temperature_2m,
            condition: weatherLabel(data.current.weather_code),
            windSpeedKmh: data.current.wind_speed_10m,
            humidityPct: data.current.relative_humidity_2m,
          };
        } catch (e) {
          return { error: e instanceof Error ? e.message : "weather lookup failed" };
        }
      },
    }),

    // --- Inspection discovery ----------------------------------------------
    findTemplates: tool({
      description:
        "Search inspection templates by name or industry keyword. Use to answer " +
        "'which inspection am I doing?' when it can't be inferred.",
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }) => {
        const me = await ctx.runQuery(api.me.current, {});
        if (!me?.orgId) return { error: "Not authenticated to an org." };
        const all = await ctx.runQuery(api.templates.list, { orgId: me.orgId });
        const q = query.toLowerCase();
        const matches = all
          .filter(
            (t) =>
              t.name.toLowerCase().includes(q) ||
              (t.industry ?? "").toLowerCase().includes(q),
          )
          .slice(0, 8)
          .map((t) => ({ id: t._id, name: t.name, industry: t.industry }));
        return { templates: matches, count: matches.length };
      },
    }),
    startInspection: tool({
      description:
        "Start a new inspection from a template id (from findTemplates). Returns the new " +
        "inspectionId — use it for subsequent setAnswer calls.",
      inputSchema: z.object({ templateId: z.string() }),
      execute: async ({ templateId }) => {
        const me = await ctx.runQuery(api.me.current, {});
        if (!me?.orgId || !me.userId)
          return { error: "Not authenticated — reload and try again." };
        const id = await ctx.runMutation(api.inspections.start, {
          orgId: me.orgId,
          templateId: templateId as Id<"templates">,
          inspectorId: me.userId,
        });
        return { inspectionId: id };
      },
    }),

    // --- Safety actions ----------------------------------------------------
    checkCurrency: tool({
      description:
        "Check register currency (licences, competencies, SDS, insurance, inductions) — " +
        "warns about expired / expiring-soon / review-due items.",
      inputSchema: z.object({ registerType: z.string().optional() }),
      execute: async ({ registerType }) => {
        const me = await ctx.runQuery(api.me.current, {});
        if (!me?.orgId) return { error: "Not authenticated." };
        const entries = await ctx.runQuery(api.registers.list, { orgId: me.orgId });
        const list = registerType
          ? entries.filter((e) => e.registerType === registerType)
          : entries;
        const urgent = list
          .filter((e) => e.status && e.status !== "current")
          .map((e) => ({
            label: e.label,
            type: e.registerType,
            status: e.status,
            expiresAt: e.expiresAt ?? null,
          }));
        return { total: list.length, urgent, urgentCount: urgent.length };
      },
    }),
    raiseAction: tool({
      description: "Create a corrective action / safety task.",
      inputSchema: z.object({
        title: z.string(),
        description: z.string().optional(),
        priority: z.enum(["low", "medium", "high", "critical"]),
      }),
      execute: async ({ title, description, priority }) => {
        const me = await ctx.runQuery(api.me.current, {});
        if (!me?.orgId) return { error: "Not authenticated." };
        const actionId = await ctx.runMutation(api.actions.create, {
          orgId: me.orgId,
          title,
          description,
          priority,
        });
        return { actionId };
      },
    }),
    reportIncident: tool({
      description:
        "Report a workplace incident. Set notifiable:true for regulator-reportable events.",
      inputSchema: z.object({
        incidentType: z.enum(["injury", "near_miss", "dangerous_occurrence", "illness"]),
        description: z.string(),
        notifiable: z.boolean(),
        occurredAt: z.string().describe("ISO-8601 datetime"),
      }),
      execute: async ({ incidentType, description, notifiable, occurredAt }) => {
        const me = await ctx.runQuery(api.me.current, {});
        if (!me?.orgId) return { error: "Not authenticated." };
        const parsed = Date.parse(occurredAt);
        const issueId = await ctx.runMutation(api.incidents.report, {
          orgId: me.orgId,
          incidentType,
          description,
          notifiable,
          occurredAt: Number.isNaN(parsed) ? Date.now() : parsed,
          reportedBy: me.userId ?? undefined,
        });
        return { issueId, notifiable };
      },
    }),
    lookupAsset: tool({
      description: "Look up an asset/plant item by its QR code string.",
      inputSchema: z.object({ qrCode: z.string() }),
      execute: async ({ qrCode }) => {
        const me = await ctx.runQuery(api.me.current, {});
        if (!me?.orgId) return { error: "Not authenticated." };
        const asset = await ctx.runQuery(api.assets.getByQr, {
          orgId: me.orgId,
          qrCode,
        });
        return asset ?? { error: "Asset not found." };
      },
    }),
  };
}

/** System prompt for the disciplined, assisted-fill inspection assistant. */
const INSPECTION_SYSTEM_PROMPT = [
  "You are a field safety inspection assistant. You help technicians complete inspections by",
  "recording exactly what they tell you — you NEVER invent, guess, or auto-fill answers.",
  "",
  "Rules you must follow without exception:",
  "1. Only call setAnswer for a value the user explicitly stated, or that a tool produced",
  "   (getCurrentLocation, getWeather, getCurrentDateTime, reviewPhotos). Never fabricate.",
  "2. After recording everything the user gave you, call getOutstandingRequired. If anything",
  "   remains, ask ONE concise message listing the remaining required fields by label, and wait",
  "   for the user's reply before recording more.",
  "3. If there is no current inspection and you can't infer which one, ask: \"Which inspection",
  "   are you performing?\" then use findTemplates and startInspection.",
  "4. Only call completeInspection after getOutstandingRequired reports allDone AND the user has",
  "   explicitly said to submit/complete/finish.",
  "5. For a failing or out-of-range answer, include a short note and set flagged:true.",
  "6. Use getCurrentDateTime for date questions and getCurrentLocation/getWeather for site and",
  "   weather/conditions questions rather than guessing.",
  "7. Be brief and field-friendly. Confirm what you recorded, then ask for what's still needed.",
].join("\n");

/**
 * Demo assistant used when AI_GATEWAY_API_KEY is absent. It mirrors the live
 * (model-driven) behaviour without a model: it pulls the device location and
 * weather (mocked to Melbourne / fine when the device sent none), records ONLY
 * the site & weather questions from those tool results (tool-derived, not
 * fabricated), then lists the required fields the user still has to provide.
 * The real model path runs when the gateway key is set.
 */
async function scriptedAssistant(
  ctx: ActionCtx,
  inspectionId: Id<"inspections">,
  device: DeviceContext,
  writer: { write: (chunk: UIMessageChunk) => void },
) {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const text = async (id: string, body: string) => {
    writer.write({ type: "text-start", id });
    for (const c of body.split(/(?<=\s)/)) {
      writer.write({ type: "text-delta", id, delta: c });
      await sleep(12);
    }
    writer.write({ type: "text-end", id });
  };
  const toolCard = async (
    id: string,
    name: string,
    input: Record<string, unknown>,
    output: unknown,
    delay = 280,
  ) => {
    writer.write({ type: "tool-input-start", toolCallId: id, toolName: name });
    writer.write({ type: "tool-input-available", toolCallId: id, toolName: name, input });
    await sleep(delay);
    writer.write({ type: "tool-output-available", toolCallId: id, output });
  };

  const form = await ctx.runQuery(api.inspections.get, { inspectionId });
  if (!form) {
    await text("err", "I couldn't find that inspection.");
    return;
  }
  await text(
    "intro",
    `On it — let me check your location and the weather for **${form.templateName}**.\n`,
  );

  const questions = (form.sections as { questions: FormQuestion[] }[]).flatMap(
    (s) => s.questions,
  );
  await toolCard("t_form", "getInspectionForm", {}, { questions: questions.length });

  // Location (mocked Melbourne unless the device provided one) + fine weather.
  const location = device.location ?? {
    lat: -37.8136,
    lng: 144.9631,
    address: "Melbourne VIC, Australia",
  };
  const address = location.address ?? "Melbourne VIC, Australia";
  await toolCard("t_loc", "getCurrentLocation", {}, { ...location, address });
  const weather = { temperatureC: 18, condition: "Fine" };
  await toolCard(
    "t_wx",
    "getWeather",
    { lat: location.lat, lng: location.lng },
    weather,
  );

  // Record ONLY the site/weather questions from those tool results.
  const ctxAnswers = pickContextAnswers(form.sections as never, {
    address,
    condition: weather.condition,
    temperatureC: weather.temperatureC,
  });
  let i = 0;
  for (const a of ctxAnswers) {
    const label = questions.find((q) => q.id === a.questionId)?.label ?? a.questionId;
    const cid = `t_set_${i++}`;
    writer.write({ type: "tool-input-start", toolCallId: cid, toolName: "setAnswer" });
    writer.write({
      type: "tool-input-available",
      toolCallId: cid,
      toolName: "setAnswer",
      input: { questionId: a.questionId, label, value: a.value },
    });
    await ctx.runMutation(api.inspections.setAnswer, {
      inspectionId,
      questionId: a.questionId,
      value: a.value,
    });
    await sleep(110);
    writer.write({ type: "tool-output-available", toolCallId: cid, output: { ok: true } });
  }

  const fresh = await ctx.runQuery(api.inspections.get, { inspectionId });
  const outstanding = computeOutstanding(
    (fresh?.sections ?? []) as Parameters<typeof computeOutstanding>[0],
    (fresh?.inspection.responses ?? []) as Parameters<typeof computeOutstanding>[1],
  );
  await toolCard("t_out", "getOutstandingRequired", {}, outstanding);

  const remaining = outstanding.outstanding.slice(0, 6).map((o) => o.label).join(", ");
  await text(
    "outro",
    `\nYou're at **${address}** and conditions are **${weather.condition}, ${weather.temperatureC}°C** — ` +
      "I've recorded the site and weather from that. I won't fill anything you haven't told me, " +
      `so I still need: **${remaining || "nothing — you're all set"}**. Tell me and I'll add them.`,
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
      location?: { lat: number; lng: number; address?: string };
      deviceTime?: string;
    };
    const messages = body.messages;
    const hasKey = !!process.env.AI_GATEWAY_API_KEY;
    const device: DeviceContext = {
      location: body.location,
      deviceTime: body.deviceTime,
    };
    // Haiku by default; escalate to Sonnet when the turn carries an image/attachment.
    const model = selectAssistantModel(messages);

    // Inspection-assist mode: the technician is completing a form via chat.
    if (body.inspectionId) {
      const inspectionId = body.inspectionId as Id<"inspections">;
      if (hasKey) {
        const result = streamText({
          model,
          system: INSPECTION_SYSTEM_PROMPT,
          messages: convertToModelMessages(messages),
          tools: assistantTools(ctx, inspectionId, device),
          stopWhen: stepCountIs(INSPECTION_MAX_STEPS),
        });
        return result.toUIMessageStreamResponse({ headers: streamHeaders });
      }
      const stream = createUIMessageStream({
        execute: async ({ writer }) =>
          scriptedAssistant(ctx, inspectionId, device, writer),
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
            `\nThe weather call succeeded; the order lookup errored (demo). ${reply}`,
          );
        },
      });
      return createUIMessageStreamResponse({ stream, headers: streamHeaders });
    }

    const result = streamText({
      model,
      system: INSPECTION_SYSTEM_PROMPT,
      messages: convertToModelMessages(messages),
      tools: assistantTools(ctx, undefined, device),
      stopWhen: stepCountIs(INSPECTION_MAX_STEPS),
    });

    return result.toUIMessageStreamResponse({ headers: streamHeaders });
  }),
});

export default http;

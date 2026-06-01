"use client";

import { useEffect, useMemo, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { Check, X } from "lucide-react";
import { useWebAuth, convexSiteUrl } from "@/app/auth-provider";
import { MemoizedMarkdown } from "@/components/chat/memoized-markdown";
import { AnimatedShinyText } from "@/components/ui/animated-shiny-text";

function textOf(message: UIMessage): string {
  return message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

type UIPart = UIMessage["parts"][number];

function isToolPart(part: UIPart): boolean {
  return part.type === "dynamic-tool" || part.type.startsWith("tool-");
}

type ToolView = {
  name: string;
  state: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  errorText?: string;
};

/** A boolean-ish answer rendered as a ✓/✗ toggle; anything else as plain text. */
function ValueChip({ value }: { value: unknown }) {
  if (value === undefined || value === null || value === "") return null;
  const s = String(value).toLowerCase();
  const truthy = value === true || ["pass", "yes", "true", "ok"].includes(s);
  const falsy = value === false || ["fail", "no", "false"].includes(s);
  const na = s === "na" || s === "n/a";

  if (truthy || falsy) {
    const label = value === true ? "Yes" : value === false ? "No" : String(value);
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[12px] font-medium capitalize ${
          truthy ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
        }`}
      >
        {truthy ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
        {label}
      </span>
    );
  }
  return (
    <span className="rounded-md bg-neutral-100 px-2 py-0.5 text-[12px] font-medium text-neutral-700">
      {na ? "N/A" : String(value)}
    </span>
  );
}

/** Turn a raw tool part into a plain-language command + optional trailing detail/value. */
function describeTool(name: string, input: Record<string, unknown>, output: Record<string, unknown>) {
  switch (name) {
    case "getInspectionForm": {
      const n =
        typeof output.questions === "number"
          ? output.questions
          : Array.isArray(output.sections)
            ? (output.sections as { questions?: unknown[] }[]).reduce(
                (a, s) => a + (s.questions?.length ?? 0),
                0,
              )
            : undefined;
      return { title: "Read the inspection form", detail: n ? `${n} questions` : undefined };
    }
    case "setAnswer":
      return {
        title: String(input.label ?? input.questionId ?? "Set answer"),
        value: input.value,
      };
    case "completeInspection": {
      const score = output.score;
      const actions = output.actionsCreated;
      return {
        title: "Complete inspection",
        detail:
          typeof score === "number"
            ? `Scored ${score}%${typeof actions === "number" ? ` · ${actions} actions` : ""}`
            : undefined,
      };
    }
    case "getWeather": {
      const t = output.temperatureC;
      return {
        title: "Check the weather",
        detail:
          typeof t === "number"
            ? `${Math.round(t)}°C${output.condition ? ` · ${output.condition}` : ""}`
            : undefined,
      };
    }
    case "getCurrentLocation":
      return { title: "Get your location", detail: output.address ? String(output.address) : undefined };
    case "getCurrentDateTime":
      return {
        title: "Read the date & time",
        detail: output.iso ? String(output.iso).slice(0, 16).replace("T", " ") : undefined,
      };
    case "getOutstandingRequired": {
      const n = output.count;
      return {
        title: "Check what's still needed",
        detail: typeof n === "number" ? (n === 0 ? "All required done" : `${n} remaining`) : undefined,
      };
    }
    case "findTemplates": {
      const n = Array.isArray(output.templates) ? output.templates.length : output.count;
      return {
        title: `Search templates: "${String(input.query ?? "")}"`,
        detail: typeof n === "number" ? `${n} found` : undefined,
      };
    }
    case "startInspection":
      return { title: "Start a new inspection" };
    case "checkCurrency": {
      const n = output.urgentCount;
      return {
        title: "Check register currency",
        detail: typeof n === "number" ? (n === 0 ? "All current" : `${n} need attention`) : undefined,
      };
    }
    case "raiseAction":
      return { title: `Raise action: ${String(input.title ?? "")}` };
    case "reportIncident":
      return {
        title: `Report incident${input.incidentType ? `: ${String(input.incidentType).replace("_", " ")}` : ""}`,
        detail: output.notifiable ? "Notifiable" : undefined,
      };
    case "lookupAsset":
      return { title: `Look up asset: ${String(input.qrCode ?? "")}`, detail: output.name ? String(output.name) : undefined };
    case "reviewPhotos": {
      const n = output.photosAnalyzed;
      return { title: "Review attached photos", detail: typeof n === "number" ? `${n} analysed` : undefined };
    }
    default:
      return { title: name };
  }
}

function ToolCall({ part }: { part: UIPart }) {
  const p = part as unknown as ToolView & { type: string };
  const name = p.name ?? p.type.replace(/^tool-/, "") ?? "tool";
  const busy = p.state === "input-streaming" || p.state === "input-available";
  const error = p.state === "output-error";
  const { title, detail, value } = describeTool(name, p.input ?? {}, p.output ?? {});

  return (
    <div className="flex items-center gap-3 rounded-lg border border-black/10 bg-white px-3.5 py-2.5">
      {busy ? (
        <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-amber-400" />
      ) : (
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${error ? "bg-rose-500" : "bg-emerald-500"}`}
        />
      )}
      <span className="flex-1 truncate text-[14px] font-medium text-[#2D2D2D]">
        {busy ? (
          <AnimatedShinyText className="text-inherit">{title}…</AnimatedShinyText>
        ) : (
          title
        )}
      </span>
      {error ? (
        <span className="truncate text-[12px] font-medium text-rose-600">
          {p.errorText ?? "Failed"}
        </span>
      ) : value !== undefined ? (
        <ValueChip value={value} />
      ) : detail ? (
        <span className="truncate text-[12px] font-medium text-gray-500">{detail}</span>
      ) : null}
    </div>
  );
}

export default function Chat({ inspectionId }: { inspectionId?: string }) {
  const { getToken } = useWebAuth();
  const [input, setInput] = useState(
    inspectionId ? "Please fill out and complete this inspection." : "",
  );

  // Best-effort browser geolocation so the assistant's location/weather tools work
  // on web too. Silently ignored if unavailable or denied.
  const [geo, setGeo] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => setGeo({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => {},
      { enableHighAccuracy: false, timeout: 8000 },
    );
  }, []);

  // Stream from the authenticated Convex /chat action (same endpoint as native),
  // attaching the current WorkOS or guest token on every request. When an
  // inspection is active, the server fills/completes it via tools.
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `${convexSiteUrl()}/chat`,
        body: {
          ...(inspectionId ? { inspectionId } : {}),
          ...(geo ? { location: geo } : {}),
          deviceTime: new Date().toISOString(),
        },
        fetch: (async (url: RequestInfo | URL, opts?: RequestInit) => {
          const token = await getToken();
          return fetch(url, {
            ...opts,
            headers: {
              ...(opts?.headers as Record<string, string> | undefined),
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
          });
        }) as typeof fetch,
      }),
    [getToken, inspectionId, geo],
  );

  const { messages, sendMessage, status } = useChat({ transport });
  const busy = status === "submitted" || status === "streaming";

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    sendMessage({ text });
    setInput("");
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-[#EDEDED]">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-6">
          {messages.length === 0 ? (
            <p className="mt-20 text-center text-gray-500">
              Send a message to get started
            </p>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                className={
                  m.role === "user" ? "flex justify-end" : "flex justify-start"
                }
              >
                <div
                  className={
                    "max-w-[85%] rounded-2xl px-4 py-2.5 text-[15px] " +
                    (m.role === "user"
                      ? "whitespace-pre-wrap bg-[#0D87E1] text-white"
                      : "bg-white text-[#2D2D2D] shadow-sm")
                  }
                >
                  {m.role === "user" ? (
                    textOf(m)
                  ) : (
                    <div className="space-y-2">
                      {m.parts.map((part, i) => {
                        if (part.type === "text") {
                          return part.text ? (
                            <MemoizedMarkdown
                              key={i}
                              content={part.text}
                              id={`${m.id}-${i}`}
                            />
                          ) : null;
                        }
                        if (isToolPart(part)) {
                          return <ToolCall key={i} part={part} />;
                        }
                        return null;
                      })}
                      {!m.parts.some(
                        (p) =>
                          (p.type === "text" && p.text) || isToolPart(p),
                      ) && <AnimatedShinyText>Thinking…</AnimatedShinyText>}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}

          {status === "submitted" && (
            <div className="flex justify-start">
              <div className="rounded-2xl bg-white px-4 py-2.5 shadow-sm">
                <AnimatedShinyText>Thinking…</AnimatedShinyText>
              </div>
            </div>
          )}
        </div>
      </div>

      <form
        onSubmit={onSubmit}
        className="border-t border-black/10 bg-white px-4 py-3"
      >
        <div className="mx-auto flex w-full max-w-2xl items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Chat with the assistant…"
            className="flex-1 rounded-full border border-[#D0D5DD] px-4 py-2.5 text-[15px] outline-none focus:border-[#0D87E1]"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="rounded-full bg-[#0D87E1] px-5 py-2.5 font-medium text-white disabled:opacity-50"
          >
            {busy ? "…" : "Send"}
          </button>
        </div>
      </form>
    </div>
  );
}

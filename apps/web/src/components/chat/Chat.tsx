"use client";

import { useMemo, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
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
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

const TOOL_STATE: Record<string, { label: string; cls: string; busy: boolean }> = {
  "input-streaming": { label: "Preparing", cls: "bg-amber-100 text-amber-700", busy: true },
  "input-available": { label: "Running", cls: "bg-blue-100 text-blue-700", busy: true },
  "output-available": { label: "Done", cls: "bg-green-100 text-green-700", busy: false },
  "output-error": { label: "Error", cls: "bg-red-100 text-red-700", busy: false },
};

function ToolCall({ part }: { part: UIPart }) {
  const p = part as unknown as ToolView & { type: string };
  const name = p.name ?? p.type.replace(/^tool-/, "") ?? "tool";
  const meta = TOOL_STATE[p.state] ?? {
    label: p.state,
    cls: "bg-gray-100 text-gray-700",
    busy: false,
  };

  return (
    <div className="overflow-hidden rounded-lg border border-black/10 bg-gray-50">
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="text-[13px] font-medium">🛠 {name}</span>
        <span className={`rounded-full px-2 py-0.5 text-[11px] ${meta.cls}`}>
          {meta.busy ? (
            <AnimatedShinyText className="text-inherit">
              {meta.label}…
            </AnimatedShinyText>
          ) : (
            meta.label
          )}
        </span>
      </div>
      {p.input != null && (
        <pre className="overflow-x-auto border-t border-black/5 px-3 py-2 text-[12px] text-gray-600">
          {JSON.stringify(p.input, null, 2)}
        </pre>
      )}
      {p.state === "output-available" && p.output != null && (
        <pre className="overflow-x-auto border-t border-black/5 bg-green-50/50 px-3 py-2 text-[12px] text-gray-700">
          {JSON.stringify(p.output, null, 2)}
        </pre>
      )}
      {p.state === "output-error" && (
        <div className="border-t border-black/5 bg-red-50/50 px-3 py-2 text-[12px] text-red-600">
          {p.errorText ?? "Tool error"}
        </div>
      )}
    </div>
  );
}

export default function Chat({ inspectionId }: { inspectionId?: string }) {
  const { getToken } = useWebAuth();
  const [input, setInput] = useState(
    inspectionId ? "Please fill out and complete this inspection." : "",
  );

  // Stream from the authenticated Convex /chat action (same endpoint as native),
  // attaching the current WorkOS or guest token on every request. When an
  // inspection is active, the server fills/completes it via tools.
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `${convexSiteUrl()}/chat`,
        body: inspectionId ? { inspectionId } : undefined,
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
    [getToken, inspectionId],
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

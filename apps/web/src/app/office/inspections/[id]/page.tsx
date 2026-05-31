"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { ChevronLeft, FileDown, FileText, Sparkles } from "lucide-react";
import {
  ScoreBadge,
  StatusPill,
  formatAnswer,
  formatDate,
} from "@/lib/beacon-ui";

type Question = { id: string; label: string; type: string };
type Section = { id?: string; title: string; questions: Question[] };
type Response = {
  questionId: string;
  value?: unknown;
  note?: string;
  flagged?: boolean;
  mediaIds?: Id<"media">[];
};

export default function InspectionDetailPage() {
  const params = useParams<{ id: string }>();
  const inspectionId = params.id as Id<"inspections">;
  const complete = useMutation(api.inspections.complete);
  const generateReport = useAction(api.reports.generate);
  const [completing, setCompleting] = useState(false);
  const [report, setReport] = useState<"idle" | "working">("idle");

  const onDownloadReport = async () => {
    if (report === "working") return;
    setReport("working");
    try {
      const { url } = await generateReport({ inspectionId });
      if (url) window.open(url, "_blank", "noopener");
    } finally {
      setReport("idle");
    }
  };

  const data = useQuery(api.inspections.get, { inspectionId });

  const responsesById = useMemo(() => {
    const map = new Map<string, Response>();
    for (const r of (data?.inspection.responses ?? []) as Response[])
      map.set(r.questionId, r);
    return map;
  }, [data]);

  // Resolve attached photo evidence to display URLs.
  const allMediaIds = useMemo(
    () =>
      ((data?.inspection.responses ?? []) as Response[]).flatMap(
        (r) => r.mediaIds ?? [],
      ),
    [data],
  );
  const mediaUrls = useQuery(
    api.media.urls,
    allMediaIds.length ? { ids: allMediaIds } : "skip",
  );
  const mediaById = useMemo(() => {
    const m = new Map<
      string,
      { url: string | null; kind: string; name: string | null }
    >();
    for (const u of mediaUrls ?? [])
      m.set(u.mediaId as string, { url: u.url, kind: u.kind, name: u.name });
    return m;
  }, [mediaUrls]);

  if (data === undefined) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-10">
        <div className="h-8 w-64 animate-pulse rounded bg-neutral-200" />
      </div>
    );
  }
  if (data === null) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-10 text-sm text-muted-foreground">
        Inspection not found.{" "}
        <Link href="/office" className="underline">
          Back to inspections
        </Link>
      </div>
    );
  }

  const { inspection, templateName, sections } = data;
  const typedSections = sections as unknown as Section[];
  const answered = (inspection.responses as Response[]).filter(
    (r) => r.value !== undefined && r.value !== null && r.value !== "",
  ).length;
  const total = typedSections.reduce((n, s) => n + s.questions.length, 0);
  const isDone = inspection.status !== "in_progress";

  const onComplete = async () => {
    if (completing) return;
    setCompleting(true);
    try {
      await complete({ inspectionId });
    } finally {
      setCompleting(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <Link
        href="/office"
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-neutral-900"
      >
        <ChevronLeft className="h-4 w-4" /> Inspections
      </Link>

      <header className="mb-8">
        <div className="flex items-center gap-3">
          <h1 className="font-montserrat text-2xl font-bold tracking-tight">
            {templateName}
          </h1>
          <StatusPill status={inspection.status} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted-foreground">
          <span>
            {answered} of {total} answered
          </span>
          {isDone && (
            <span className="flex items-center gap-1.5">
              Score: <ScoreBadge score={inspection.score} />
            </span>
          )}
          <span>Started {formatDate(inspection.startedAt)}</span>
          {inspection.completedAt && (
            <span>Completed {formatDate(inspection.completedAt)}</span>
          )}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          {!isDone && (
            <>
              <Link
                href={`/?inspectionId=${inspectionId}`}
                className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-neutral-700"
              >
                <Sparkles className="h-4 w-4" /> Complete with the assistant
              </Link>
              <button
                type="button"
                onClick={onComplete}
                disabled={completing}
                className="rounded-lg border border-border bg-white px-3.5 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
              >
                {completing ? "Submitting…" : "Mark complete"}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onDownloadReport}
            disabled={report === "working"}
            className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium disabled:opacity-50 ${
              isDone
                ? "bg-neutral-900 text-white hover:bg-neutral-700"
                : "border border-border bg-white text-neutral-700 hover:bg-neutral-50"
            }`}
          >
            <FileDown className="h-4 w-4" />
            {report === "working" ? "Generating…" : "PDF report"}
          </button>
        </div>
      </header>

      <div className="space-y-6">
        {typedSections.map((section, si) => (
          <section
            key={section.id ?? si}
            className="overflow-hidden rounded-xl border border-border bg-white"
          >
            <div className="border-b border-border bg-neutral-50 px-5 py-3">
              <h2 className="font-medium text-neutral-900">{section.title}</h2>
            </div>
            <ul className="divide-y divide-border">
              {section.questions.map((q) => {
                const r = responsesById.get(q.id);
                return (
                  <li key={q.id} className="px-5 py-3.5">
                    <p className="text-sm text-neutral-900">{q.label}</p>
                    <p className="mt-1 text-sm font-medium">
                      {formatAnswer(r?.value)}
                      {r?.flagged && (
                        <span className="ml-2 rounded bg-rose-50 px-1.5 py-0.5 text-xs font-medium text-rose-600 ring-1 ring-inset ring-rose-600/20">
                          Flagged
                        </span>
                      )}
                    </p>
                    {r?.note && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Note: {r.note}
                      </p>
                    )}
                    {r?.mediaIds && r.mediaIds.length > 0 && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {r.mediaIds.map((mid) => {
                          const m = mediaById.get(mid as string);
                          if (!m) {
                            return (
                              <div
                                key={mid}
                                className="h-16 w-16 animate-pulse rounded-md bg-neutral-100"
                              />
                            );
                          }
                          if (m.kind === "doc") {
                            return (
                              <a
                                key={mid}
                                href={m.url ?? "#"}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex max-w-[16rem] items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
                              >
                                <FileText className="h-4 w-4 shrink-0 text-neutral-500" />
                                <span className="truncate">
                                  {m.name ?? "Document"}
                                </span>
                              </a>
                            );
                          }
                          return (
                            <a
                              key={mid}
                              href={m.url ?? "#"}
                              target="_blank"
                              rel="noreferrer"
                              className="group relative block"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              {/* biome-ignore lint/performance/noImgElement: external Convex storage URL — next/image would need remote config */}
                              <img
                                src={m.url ?? ""}
                                alt="Inspection evidence"
                                className="h-16 w-16 rounded-md object-cover ring-1 ring-inset ring-border transition group-hover:ring-neutral-400"
                              />
                            </a>
                          );
                        })}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

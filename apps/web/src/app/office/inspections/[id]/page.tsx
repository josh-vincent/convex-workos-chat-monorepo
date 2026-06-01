"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import {
  ChevronLeft,
  FileDown,
  FileText,
  Package,
  Share2,
  Sparkles,
} from "lucide-react";
import {
  ScoreBadge,
  StatusPill,
  formatAnswer,
  formatDate,
} from "@/lib/beacon-ui";
import { useBeacon } from "@/hooks/useBeacon";

type Question = { id: string; label: string; type: string };
type Section = { id?: string; title: string; questions: Question[] };
type Response = {
  questionId: string;
  value?: unknown;
  note?: string;
  flagged?: boolean;
  mediaIds?: Id<"media">[];
};

// ── Compliance-pack panel ────────────────────────────────────────────────────

function CompliancePackPanel({
  inspectionId,
  anchorType,
  anchorId,
  onClose,
}: {
  inspectionId: Id<"inspections">;
  anchorType?: string;
  anchorId?: string;
  onClose: () => void;
}) {
  const resolvedAnchorType = anchorType as
    | "job"
    | "site"
    | "contract"
    | "person"
    | "asset"
    | undefined;
  // anchorId is only meaningful when anchorType is set; fall back to inspectionId
  // only for display (not passed to query — query is skipped when no anchorType).
  const resolvedAnchorId = anchorId ?? (inspectionId as string);

  const manifest = useQuery(
    api.compliance.packData,
    resolvedAnchorType !== undefined
      ? { anchorType: resolvedAnchorType, anchorId: resolvedAnchorId }
      : "skip",
  );

  const [packing, setPacking] = useState(false);
  const [packUrl, setPackUrl] = useState<string | null>(null);
  const packAction = useAction(api.compliancePack.pack);

  const handleDownload = async () => {
    if (packing || resolvedAnchorType === undefined) return;
    setPacking(true);
    try {
      const url = await packAction({
        anchorType: resolvedAnchorType,
        anchorId: resolvedAnchorId,
      });
      setPackUrl(url);
      // Open the PDF immediately in a new tab.
      if (url) window.open(url, "_blank", "noopener");
    } finally {
      setPacking(false);
    }
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop dismiss
    // biome-ignore lint/a11y/useKeyWithClickEvents: modal backdrop dismiss
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-sm rounded-2xl border border-border bg-white p-6 shadow-xl">
        <h2 className="font-montserrat text-lg font-bold">Compliance pack</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Assembled manifest for this inspection&apos;s anchor.
        </p>

        {resolvedAnchorType === undefined ? (
          <div className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
            This inspection has no anchor (job/site/person/asset). Attach it to
            an anchor to generate a compliance pack.
          </div>
        ) : manifest === undefined ? (
          <div className="mt-4 space-y-2">
            {["a", "b", "c", "d"].map((k) => (
              <div
                key={k}
                className="h-8 animate-pulse rounded-md bg-neutral-100"
              />
            ))}
          </div>
        ) : (
          <dl className="mt-4 grid grid-cols-2 gap-3">
            {(
              [
                ["Inspections", manifest.counts.inspections],
                ["Actions", manifest.counts.actions],
                ["Register entries", manifest.counts.registers],
                ["Media files", manifest.counts.mediaIds],
              ] as [string, number][]
            ).map(([label, count]) => (
              <div
                key={label}
                className="rounded-lg border border-border bg-neutral-50 px-4 py-3 text-center"
              >
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="mt-0.5 text-2xl font-bold text-neutral-900">
                  {count}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {packUrl && (
          <a
            href={packUrl}
            target="_blank"
            rel="noopener noreferrer"
            download="compliance-pack.pdf"
            className="mt-4 block w-full rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-center text-sm font-medium text-emerald-700 hover:bg-emerald-100"
          >
            Open / download compliance pack PDF
          </a>
        )}

        <div className="mt-5 flex justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Close
          </button>
          {resolvedAnchorType !== undefined && !packUrl && (
            <button
              type="button"
              onClick={handleDownload}
              disabled={packing || manifest === undefined}
              className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
            >
              <Package className="h-4 w-4" />
              {packing ? "Assembling…" : "Generate pack"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── SWMS share button ─────────────────────────────────────────────────────────
//
// Queries contracts.listByOrg for the org, lets the user pick a principal
// contractor (or defaults to the first), then calls swms.shareToPrincipal.
// If the org has no contracts, shows a graceful message plus a one-click
// "Create a demo contract" affordance.

function SwmsShareButton({
  inspectionId,
  swmsSharedAt,
  orgId,
}: {
  inspectionId: Id<"inspections">;
  swmsSharedAt?: number;
  orgId: Id<"organizations"> | null | undefined;
}) {
  const share = useMutation(api.swms.shareToPrincipal);
  const createContract = useMutation(api.contracts.create);
  const [sharing, setSharing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [sharedAt, setSharedAt] = useState<number | undefined>(swmsSharedAt);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<Id<"contracts"> | "">("");

  const contracts = useQuery(
    api.contracts.listByOrg,
    orgId ? { orgId } : "skip",
  );

  // Once contracts load, seed the selector to the first entry.
  const firstContract = contracts?.[0];
  const effectiveId: Id<"contracts"> | undefined =
    (selectedId as Id<"contracts"> | "") || firstContract?._id;

  const handleShare = async () => {
    if (sharing || !effectiveId) return;
    setSharing(true);
    setError(null);
    try {
      const result = await share({
        inspectionId,
        principalContractorId: effectiveId,
      });
      setSharedAt(result.sharedAt);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to share.");
    } finally {
      setSharing(false);
    }
  };

  const handleCreateDemo = async () => {
    if (creating || !orgId) return;
    setCreating(true);
    setError(null);
    try {
      await createContract({
        orgId,
        name: "Demo Principal Contractor",
        status: "active",
      });
      // contracts query will re-run reactively; selector will populate.
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create contract.");
    } finally {
      setCreating(false);
    }
  };

  if (sharedAt) {
    return (
      <span className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-sm font-medium text-emerald-700">
        <Share2 className="h-4 w-4" />
        Shared {formatDate(sharedAt)}
      </span>
    );
  }

  // Still loading
  if (contracts === undefined) {
    return (
      <div className="h-9 w-52 animate-pulse rounded-lg bg-neutral-100" />
    );
  }

  // No contracts in this org
  if (contracts.length === 0) {
    return (
      <div className="flex flex-col items-start gap-1.5">
        <p className="max-w-xs text-xs text-muted-foreground">
          No principal contractor on record.
        </p>
        <button
          type="button"
          onClick={handleCreateDemo}
          disabled={creating || !orgId}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-3.5 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
        >
          <Share2 className="h-4 w-4" />
          {creating ? "Creating…" : "Create a demo contract"}
        </button>
        {error && <p className="max-w-xs text-xs text-rose-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <div className="flex items-center gap-2">
        {contracts.length > 1 && (
          <select
            value={selectedId || firstContract?._id}
            onChange={(e) => setSelectedId(e.target.value as Id<"contracts">)}
            className="input rounded-lg border border-border bg-white px-2 py-1.5 text-sm text-neutral-700"
          >
            {contracts.map((c) => (
              <option key={c._id} value={c._id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          onClick={handleShare}
          disabled={sharing || !effectiveId}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-3.5 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
        >
          <Share2 className="h-4 w-4" />
          {sharing
            ? "Sharing…"
            : contracts.length === 1
              ? `Share with ${firstContract?.name}`
              : "Share with principal contractor"}
        </button>
      </div>
      {error && <p className="max-w-xs text-xs text-rose-600">{error}</p>}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function InspectionDetailPage() {
  const params = useParams<{ id: string }>();
  const inspectionId = params.id as Id<"inspections">;
  const beacon = useBeacon();
  const complete = useMutation(api.inspections.complete);
  const generateReport = useAction(api.reports.generate);
  const [completing, setCompleting] = useState(false);
  const [report, setReport] = useState<"idle" | "working">("idle");
  const [packOpen, setPackOpen] = useState(false);

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
      {packOpen && (
        <CompliancePackPanel
          inspectionId={inspectionId}
          anchorType={inspection.anchorType}
          anchorId={inspection.anchorId}
          onClose={() => setPackOpen(false)}
        />
      )}

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

        <div className="mt-5 flex flex-wrap items-start gap-3">
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

          {isDone && (
            <>
              <SwmsShareButton
                inspectionId={inspectionId}
                swmsSharedAt={inspection.swmsSharedAt}
                orgId={beacon?.orgId}
              />
              <button
                type="button"
                onClick={() => setPackOpen(true)}
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-3.5 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
              >
                <Package className="h-4 w-4" />
                Compliance pack
              </button>
            </>
          )}
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

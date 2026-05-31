"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useBeacon } from "@/hooks/useBeacon";

// Surface the three demo forms first.
const FEATURED = [
  "Daily Site Safety Walk",
  "Forklift Pre-Start Check",
  "Working at Heights Permit",
];

export default function OfficeTemplatesPage() {
  const me = useBeacon();
  const router = useRouter();
  const ensureUser = useMutation(api.me.ensureUser);
  const start = useMutation(api.inspections.start);
  const [starting, setStarting] = useState<string | null>(null);

  const templates = useQuery(
    api.templates.list,
    me?.orgId ? { orgId: me.orgId } : "skip",
  );

  const onStart = async (templateId: Id<"templates">) => {
    if (!me?.orgId || starting) return;
    setStarting(templateId);
    try {
      let userId = me.userId;
      if (!userId) userId = (await ensureUser()).userId;
      const inspectionId = await start({
        orgId: me.orgId,
        templateId,
        inspectorId: userId,
      });
      router.push(`/office/inspections/${inspectionId}`);
    } finally {
      setStarting(null);
    }
  };

  const loading = me === undefined || templates === undefined;
  const sorted = templates
    ? [...templates].sort((a, b) => {
        const ra = FEATURED.indexOf(a.name);
        const rb = FEATURED.indexOf(b.name);
        return (ra < 0 ? 999 : ra) - (rb < 0 ? 999 : rb);
      })
    : [];

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <header className="mb-8">
        <h1 className="font-montserrat text-2xl font-bold tracking-tight">
          Form library
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {loading
            ? "Loading templates…"
            : `${sorted.length} templates ready to inspect against.`}
        </p>
      </header>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {["a", "b", "c", "d", "e", "f"].map((k) => (
            <div
              key={k}
              className="h-28 animate-pulse rounded-xl border border-border bg-white"
            />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {sorted.map((t) => {
            const featured = FEATURED.includes(t.name);
            return (
              <div
                key={t._id}
                className={`flex flex-col rounded-xl border bg-white p-5 ${
                  featured ? "border-neutral-300 ring-1 ring-neutral-900/5" : "border-border"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="font-medium leading-snug text-neutral-900">
                    {t.name}
                  </h2>
                  {featured && (
                    <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                      Demo
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {[t.category, t.industry].filter(Boolean).join(" · ")}
                </p>
                <div className="mt-4 flex items-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => onStart(t._id)}
                    disabled={starting !== null}
                    className="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
                  >
                    {starting === t._id ? "Starting…" : "Start inspection"}
                  </button>
                  <Link
                    href={`/office/templates/${t._id}`}
                    className="text-sm font-medium text-neutral-600 hover:text-neutral-900"
                  >
                    View structure
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

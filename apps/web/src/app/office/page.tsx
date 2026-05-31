"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";
import { useBeacon } from "@/hooks/useBeacon";
import {
  ScoreBadge,
  StatusPill,
  formatDate,
} from "@/lib/beacon-ui";

export default function OfficeInspectionsPage() {
  const me = useBeacon();
  const inspections = useQuery(
    api.inspections.list,
    me?.orgId ? { orgId: me.orgId } : "skip",
  );

  const loading = me === undefined || inspections === undefined;

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <header className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="font-montserrat text-2xl font-bold tracking-tight">
            Inspections
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every safety check completed in the field, as it arrives.
          </p>
        </div>
        <Link
          href="/office/templates"
          className="rounded-lg bg-neutral-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-neutral-700"
        >
          Start an inspection
        </Link>
      </header>

      {loading ? (
        <TableSkeleton />
      ) : inspections.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-3 font-medium">Form</th>
                <th className="px-5 py-3 font-medium">Inspector</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 text-right font-medium">Score</th>
                <th className="px-5 py-3 text-right font-medium">Date</th>
              </tr>
            </thead>
            <tbody>
              {inspections.map((insp) => (
                <tr
                  key={insp._id}
                  className="border-b border-border last:border-0 hover:bg-neutral-50"
                >
                  <td className="px-5 py-3.5">
                    <Link
                      href={`/office/inspections/${insp._id}`}
                      className="font-medium text-neutral-900 hover:underline"
                    >
                      {insp.templateName}
                    </Link>
                  </td>
                  <td className="px-5 py-3.5 text-muted-foreground">
                    {insp.inspectorName}
                  </td>
                  <td className="px-5 py-3.5">
                    <StatusPill status={insp.status} />
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <ScoreBadge score={insp.score} />
                  </td>
                  <td className="px-5 py-3.5 text-right text-muted-foreground">
                    {formatDate(insp.completedAt ?? insp.startedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-border bg-white px-8 py-16 text-center">
      <p className="font-montserrat text-base font-semibold">No inspections yet</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
        When a technician completes a form in the field, it lands here with its
        score and any corrective actions.
      </p>
      <Link
        href="/office/templates"
        className="mt-5 inline-block rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
      >
        Browse forms
      </Link>
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-2">
      {["a", "b", "c", "d", "e"].map((k) => (
        <div
          key={k}
          className="h-14 animate-pulse rounded-lg border border-border bg-white"
        />
      ))}
    </div>
  );
}

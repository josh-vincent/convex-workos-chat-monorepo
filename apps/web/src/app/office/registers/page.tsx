"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";
import { useBeacon } from "@/hooks/useBeacon";
import { formatDate } from "@/lib/beacon-ui";

// ── Types ────────────────────────────────────────────────────────────────────

type RegisterStatus = "current" | "expiring_soon" | "expired" | "missing" | "review_due";

type RegisterType =
  | "licence"
  | "competency"
  | "sds"
  | "insurance"
  | "plant"
  | "induction";

// ── Status chip ──────────────────────────────────────────────────────────────

const STATUS_CHIP: Record<RegisterStatus, { label: string; cls: string }> = {
  current: {
    label: "Current",
    cls: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  },
  expiring_soon: {
    label: "Expiring soon",
    cls: "bg-amber-50 text-amber-700 ring-amber-600/20",
  },
  expired: {
    label: "Expired",
    cls: "bg-rose-50 text-rose-700 ring-rose-600/20",
  },
  missing: {
    label: "Missing",
    cls: "bg-neutral-100 text-neutral-600 ring-neutral-500/20",
  },
  review_due: {
    label: "Review due",
    cls: "bg-amber-50 text-amber-700 ring-amber-600/20",
  },
};

function RegisterStatusChip({ status }: { status: string }) {
  const s = STATUS_CHIP[status as RegisterStatus] ?? {
    label: status,
    cls: "bg-neutral-100 text-neutral-600 ring-neutral-500/20",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${s.cls}`}
    >
      {s.label}
    </span>
  );
}

// ── Register type labels ──────────────────────────────────────────────────────

const TYPE_LABELS: Record<RegisterType, string> = {
  licence: "Licence",
  competency: "Competency",
  sds: "SDS",
  insurance: "Insurance",
  plant: "Plant",
  induction: "Induction",
};

// Status sort order — urgent items rise to top.
const STATUS_ORDER: Record<string, number> = {
  expired: 0,
  expiring_soon: 1,
  review_due: 2,
  missing: 3,
  current: 4,
};

// ── Filter tab ───────────────────────────────────────────────────────────────

const FILTER_TABS: Array<{ value: RegisterType | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "licence", label: "Licences" },
  { value: "competency", label: "Competencies" },
  { value: "sds", label: "SDS" },
  { value: "insurance", label: "Insurance" },
  { value: "plant", label: "Plant" },
  { value: "induction", label: "Inductions" },
];

// ── Page ─────────────────────────────────────────────────────────────────────

export default function RegistersPage() {
  const me = useBeacon();
  const [activeType, setActiveType] = useState<RegisterType | "all">("all");

  const registers = useQuery(
    api.registers.list,
    me?.orgId ? { orgId: me.orgId } : "skip",
  );

  const loading = me === undefined || registers === undefined;

  const filtered = registers
    ? registers
        .filter((r) => activeType === "all" || r.registerType === activeType)
        .slice()
        .sort(
          (a, b) =>
            (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99),
        )
    : [];

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <header className="mb-6">
        <h1 className="font-montserrat text-2xl font-bold tracking-tight">
          Registers
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Licences, competencies, SDS, insurance, plant, and inductions — all in
          one place.
        </p>
      </header>

      {/* Type filter tabs */}
      <div className="mb-5 flex flex-wrap gap-1.5">
        {FILTER_TABS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            onClick={() => setActiveType(value)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
              activeType === value
                ? "bg-neutral-900 text-white"
                : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <TableSkeleton />
      ) : filtered.length === 0 ? (
        <EmptyState hasRegisters={(registers?.length ?? 0) > 0} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-3 font-medium">Label</th>
                <th className="px-5 py-3 font-medium">Type</th>
                <th className="px-5 py-3 font-medium">Anchor</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 text-right font-medium">Expires</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r._id}
                  className="border-b border-border last:border-0 hover:bg-neutral-50"
                >
                  <td className="px-5 py-3.5 font-medium text-neutral-900">
                    {r.label}
                  </td>
                  <td className="px-5 py-3.5 text-muted-foreground">
                    {TYPE_LABELS[r.registerType as RegisterType] ?? r.registerType}
                  </td>
                  <td className="px-5 py-3.5 text-muted-foreground">
                    <span className="capitalize">{r.anchorType}</span>
                    {r.identifier ? (
                      <span className="ml-1 text-neutral-400">
                        · {r.identifier}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-5 py-3.5">
                    <RegisterStatusChip status={r.status} />
                  </td>
                  <td className="px-5 py-3.5 text-right text-muted-foreground">
                    {formatDate(r.expiresAt)}
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

function EmptyState({ hasRegisters }: { hasRegisters: boolean }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-white px-8 py-16 text-center">
      <p className="font-montserrat text-base font-semibold">
        {hasRegisters ? "No entries match this filter" : "No register entries yet"}
      </p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
        {hasRegisters
          ? "Try switching to 'All' to see everything."
          : "Register entries track licences, competencies, SDS documents, insurance, plant, and inductions. Add them via the assistant or the API."}
      </p>
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

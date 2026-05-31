"use client";

import { useQuery } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";
import { useBeacon } from "@/hooks/useBeacon";
import { formatDate } from "@/lib/beacon-ui";

// ── Types ────────────────────────────────────────────────────────────────────

type ActionStatus = "todo" | "open" | "in_progress" | "done" | "verified";
type ActionPriority = "low" | "medium" | "high" | "critical";

// ── Status chip ──────────────────────────────────────────────────────────────

const STATUS_CHIP: Record<ActionStatus, { label: string; cls: string }> = {
  todo: { label: "To do", cls: "bg-neutral-100 text-neutral-600 ring-neutral-500/20" },
  open: { label: "Open", cls: "bg-sky-50 text-sky-700 ring-sky-600/20" },
  in_progress: { label: "In progress", cls: "bg-amber-50 text-amber-700 ring-amber-600/20" },
  done: { label: "Done", cls: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" },
  verified: { label: "Verified", cls: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" },
};

function ActionStatusChip({ status }: { status: string }) {
  const s = STATUS_CHIP[status as ActionStatus] ?? {
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

// ── Priority chip ────────────────────────────────────────────────────────────

const PRIORITY_CHIP: Record<ActionPriority, { label: string; cls: string }> = {
  low: { label: "Low", cls: "bg-neutral-100 text-neutral-500 ring-neutral-500/20" },
  medium: { label: "Medium", cls: "bg-sky-50 text-sky-600 ring-sky-500/20" },
  high: { label: "High", cls: "bg-amber-50 text-amber-700 ring-amber-600/20" },
  critical: { label: "Critical", cls: "bg-rose-50 text-rose-700 ring-rose-600/20" },
};

function PriorityChip({ priority }: { priority: string }) {
  const p = PRIORITY_CHIP[priority as ActionPriority] ?? {
    label: priority,
    cls: "bg-neutral-100 text-neutral-500 ring-neutral-500/20",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${p.cls}`}
    >
      {p.label}
    </span>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ActionsPage() {
  const me = useBeacon();

  const actions = useQuery(
    api.actions.listForOwner,
    me?.orgId ? { orgId: me.orgId } : "skip",
  );

  const loading = me === undefined || actions === undefined;

  // Sort: open/todo first (by priority), then done/verified.
  const PRIORITY_ORDER: Record<string, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };
  const STATUS_OPEN_ORDER: Record<string, number> = {
    todo: 0,
    open: 0,
    in_progress: 1,
    done: 2,
    verified: 3,
  };

  const sorted = actions
    ? actions.slice().sort((a, b) => {
        const so = (STATUS_OPEN_ORDER[a.status] ?? 9) - (STATUS_OPEN_ORDER[b.status] ?? 9);
        if (so !== 0) return so;
        return (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9);
      })
    : [];

  const openCount = sorted.filter(
    (a) => a.status === "todo" || a.status === "open" || a.status === "in_progress",
  ).length;

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <header className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="font-montserrat text-2xl font-bold tracking-tight">
            Actions
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Corrective actions raised from inspections or manually. Close the
            loop with evidence.
          </p>
        </div>
        {openCount > 0 && (
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">
            {openCount} open
          </span>
        )}
      </header>

      {loading ? (
        <TableSkeleton />
      ) : sorted.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-3 font-medium">Title</th>
                <th className="px-5 py-3 font-medium">Priority</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 text-right font-medium">Due</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((action) => (
                <tr
                  key={action._id}
                  className="border-b border-border last:border-0 hover:bg-neutral-50"
                >
                  <td className="px-5 py-3.5">
                    <span className="font-medium text-neutral-900">
                      {action.title}
                    </span>
                    {action.description ? (
                      <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                        {action.description}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-5 py-3.5">
                    <PriorityChip priority={action.priority} />
                  </td>
                  <td className="px-5 py-3.5">
                    <ActionStatusChip status={action.status} />
                  </td>
                  <td className="px-5 py-3.5 text-right text-muted-foreground">
                    {formatDate(action.dueDate)}
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
      <p className="font-montserrat text-base font-semibold">No actions yet</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
        Corrective actions are raised when inspections uncover issues. They can
        also be created manually or by the AI assistant.
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

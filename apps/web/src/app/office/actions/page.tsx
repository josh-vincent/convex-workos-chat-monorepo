"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useBeacon } from "@/hooks/useBeacon";
import { formatDate } from "@/lib/beacon-ui";
import { CheckCircle2, ChevronRight } from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

type ActionStatus = "todo" | "open" | "in_progress" | "done" | "verified";
type ActionPriority = "low" | "medium" | "high" | "critical";

type Action = {
  _id: Id<"actions">;
  title: string;
  description?: string;
  priority: ActionPriority;
  status: ActionStatus;
  dueDate?: number;
  dueAt?: number;
};

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

// ── Status chip ──────────────────────────────────────────────────────────────

const STATUS_CHIP: Record<ActionStatus, { label: string; cls: string }> = {
  todo: { label: "To do", cls: "bg-neutral-100 text-neutral-600 ring-neutral-500/20" },
  open: { label: "Open", cls: "bg-sky-50 text-sky-700 ring-sky-600/20" },
  in_progress: { label: "In progress", cls: "bg-amber-50 text-amber-700 ring-amber-600/20" },
  done: { label: "Done", cls: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" },
  verified: { label: "Verified", cls: "bg-emerald-100 text-emerald-800 ring-emerald-700/20" },
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

// ── Next-status logic ────────────────────────────────────────────────────────

type AdvanceStatus = "in_progress" | "done" | "open";

const NEXT_STATUS: Record<string, AdvanceStatus | null> = {
  todo: "in_progress",
  open: "in_progress",
  in_progress: "done",
  done: null,
  verified: null,
};

const ADVANCE_LABEL: Record<string, string> = {
  todo: "Start",
  open: "Start",
  in_progress: "Mark done",
};

// ── Verify modal ─────────────────────────────────────────────────────────────

function VerifyModal({
  action,
  onClose,
}: {
  action: Action;
  onClose: () => void;
}) {
  const verify = useMutation(api.actions.verify);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleVerify = async () => {
    if (!note.trim()) {
      setError("Please enter evidence notes before verifying.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await verify({
        actionId: action._id,
        evidence: [{ note: note.trim() }],
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to verify action.");
    } finally {
      setSaving(false);
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
      <div className="w-full max-w-md rounded-2xl border border-border bg-white p-6 shadow-xl">
        <h2 className="font-montserrat text-lg font-bold">Verify action</h2>
        <p className="mt-1 text-sm text-muted-foreground">{action.title}</p>

        <div className="mt-5">
          <label
            htmlFor="verify-note"
            className="mb-1.5 block text-xs font-medium text-neutral-700"
          >
            Evidence notes <span className="text-rose-500">*</span>
          </label>
          <textarea
            id="verify-note"
            rows={3}
            placeholder="Describe what was done to close this action…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="input w-full resize-none rounded-lg"
          />
        </div>

        {error && (
          <p className="mt-2 text-xs text-rose-600">{error}</p>
        )}

        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleVerify}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
          >
            <CheckCircle2 className="h-4 w-4" />
            {saving ? "Verifying…" : "Verify"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Action row ───────────────────────────────────────────────────────────────

function ActionRow({ action }: { action: Action }) {
  const update = useMutation(api.actions.update);
  const [advancing, setAdvancing] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);

  const nextStatus = NEXT_STATUS[action.status];
  const advLabel = ADVANCE_LABEL[action.status];

  const handleAdvance = async () => {
    if (!nextStatus || advancing) return;
    setAdvancing(true);
    try {
      await update({ actionId: action._id, status: nextStatus });
    } finally {
      setAdvancing(false);
    }
  };

  const effectiveDue = action.dueAt ?? action.dueDate;
  const isOverdue =
    effectiveDue !== undefined &&
    effectiveDue < Date.now() &&
    action.status !== "done" &&
    action.status !== "verified";

  return (
    <>
      {verifyOpen && (
        <VerifyModal action={action} onClose={() => setVerifyOpen(false)} />
      )}
      <tr className="border-b border-border last:border-0 hover:bg-neutral-50">
        <td className="px-5 py-3.5">
          <span className="font-medium text-neutral-900">{action.title}</span>
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
        <td
          className={`px-5 py-3.5 text-right text-sm ${isOverdue ? "font-medium text-rose-600" : "text-muted-foreground"}`}
        >
          {effectiveDue ? formatDate(effectiveDue) : "—"}
        </td>
        <td className="px-5 py-3.5 text-right">
          <div className="flex items-center justify-end gap-2">
            {nextStatus && advLabel && (
              <button
                type="button"
                onClick={handleAdvance}
                disabled={advancing}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-white px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
              >
                {advancing ? "…" : advLabel}
                {!advancing && <ChevronRight className="h-3 w-3" />}
              </button>
            )}
            {action.status === "done" && (
              <button
                type="button"
                onClick={() => setVerifyOpen(true)}
                className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
              >
                <CheckCircle2 className="h-3 w-3" />
                Verify
              </button>
            )}
          </div>
        </td>
      </tr>
    </>
  );
}

// ── Group header ─────────────────────────────────────────────────────────────

const GROUP_LABELS: Record<string, string> = {
  active: "Active",
  done: "Done — awaiting verification",
  verified: "Closed",
};

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ActionsPage() {
  const me = useBeacon();

  const actions = useQuery(
    api.actions.listForOwner,
    me?.orgId ? { orgId: me.orgId } : "skip",
  );

  const loading = me === undefined || actions === undefined;

  const PRIORITY_ORDER: Record<string, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };

  // Group into active / done / verified buckets, sorted by priority then due date.
  const grouped: { key: string; items: Action[] }[] = [];

  if (actions) {
    const active: Action[] = [];
    const done: Action[] = [];
    const verified: Action[] = [];

    for (const a of actions as Action[]) {
      if (a.status === "verified") verified.push(a);
      else if (a.status === "done") done.push(a);
      else active.push(a);
    }

    const byPriorityThenDue = (x: Action, y: Action) => {
      const po = (PRIORITY_ORDER[x.priority] ?? 9) - (PRIORITY_ORDER[y.priority] ?? 9);
      if (po !== 0) return po;
      const xDue = x.dueAt ?? x.dueDate ?? Infinity;
      const yDue = y.dueAt ?? y.dueDate ?? Infinity;
      return xDue - yDue;
    };

    active.sort(byPriorityThenDue);
    done.sort(byPriorityThenDue);
    verified.sort((x, y) => (y.dueAt ?? y.dueDate ?? 0) - (x.dueAt ?? x.dueDate ?? 0));

    if (active.length) grouped.push({ key: "active", items: active });
    if (done.length) grouped.push({ key: "done", items: done });
    if (verified.length) grouped.push({ key: "verified", items: verified });
  }

  const openCount = actions
    ? (actions as Action[]).filter(
        (a) => a.status === "todo" || a.status === "open" || a.status === "in_progress",
      ).length
    : 0;

  const criticalCount = actions
    ? (actions as Action[]).filter(
        (a) => a.priority === "critical" && a.status !== "done" && a.status !== "verified",
      ).length
    : 0;

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <header className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="font-montserrat text-2xl font-bold tracking-tight">
            Actions
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Corrective actions raised from inspections or manually. Advance
            status and close the loop with evidence.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {criticalCount > 0 && (
            <span className="rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-700">
              {criticalCount} critical
            </span>
          )}
          {openCount > 0 && (
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">
              {openCount} open
            </span>
          )}
        </div>
      </header>

      {loading ? (
        <TableSkeleton />
      ) : grouped.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-6">
          {grouped.map(({ key, items }) => (
            <section key={key}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {GROUP_LABELS[key] ?? key} ({items.length})
              </h2>
              <div className="overflow-hidden rounded-xl border border-border bg-white">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-5 py-3 font-medium">Title</th>
                      <th className="px-5 py-3 font-medium">Priority</th>
                      <th className="px-5 py-3 font-medium">Status</th>
                      <th className="px-5 py-3 text-right font-medium">Due</th>
                      <th className="px-5 py-3 text-right font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((action) => (
                      <ActionRow key={action._id} action={action} />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
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
        Corrective actions are raised when inspections uncover issues — flagged
        answers trigger actions automatically. They can also be created manually
        or via the AI assistant. Once raised, advance status here and verify
        with evidence to close the loop.
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

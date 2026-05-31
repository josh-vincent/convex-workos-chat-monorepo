"use client";

import { useQuery } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";
import { useBeacon } from "@/hooks/useBeacon";
import { formatDate } from "@/lib/beacon-ui";
import { AlertTriangle, CheckCircle2, Clock, ShieldAlert } from "lucide-react";

// ── Register-status chip colours ────────────────────────────────────────────

type RegisterStatus = "current" | "expiring_soon" | "expired" | "missing" | "review_due";

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

// ── Alert severity chip ──────────────────────────────────────────────────────

type AlertSeverity = "critical" | "high" | "medium" | "low";

const SEVERITY_CHIP: Record<AlertSeverity, { cls: string }> = {
  critical: { cls: "bg-rose-50 text-rose-700 ring-rose-600/20" },
  high: { cls: "bg-amber-50 text-amber-700 ring-amber-600/20" },
  medium: { cls: "bg-sky-50 text-sky-700 ring-sky-600/20" },
  low: { cls: "bg-neutral-100 text-neutral-600 ring-neutral-500/20" },
};

function SeverityChip({ severity }: { severity: string }) {
  const s = SEVERITY_CHIP[severity as AlertSeverity] ?? SEVERITY_CHIP.low;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ring-1 ring-inset ${s.cls}`}
    >
      {severity}
    </span>
  );
}

// ── Summary tile ─────────────────────────────────────────────────────────────

function SummaryTile({
  label,
  count,
  icon: Icon,
  tone,
}: {
  label: string;
  count: number;
  icon: React.ElementType;
  tone: "emerald" | "amber" | "rose" | "neutral";
}) {
  const iconCls = {
    emerald: "text-emerald-600",
    amber: "text-amber-500",
    rose: "text-rose-600",
    neutral: "text-neutral-400",
  }[tone];

  const countCls = {
    emerald: "text-emerald-700",
    amber: "text-amber-600",
    rose: "text-rose-700",
    neutral: "text-neutral-600",
  }[tone];

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-white p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-neutral-600">{label}</span>
        <Icon className={`h-5 w-5 ${iconCls}`} strokeWidth={1.8} />
      </div>
      <span className={`font-montserrat text-3xl font-bold tabular-nums ${countCls}`}>
        {count}
      </span>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function CompliancePage() {
  const me = useBeacon();

  const registers = useQuery(
    api.registers.list,
    me?.orgId ? { orgId: me.orgId } : "skip",
  );

  const alerts = useQuery(
    api.currency.list,
    me?.orgId ? { orgId: me.orgId } : "skip",
  );

  const inspections = useQuery(
    api.inspections.list,
    me?.orgId ? { orgId: me.orgId } : "skip",
  );

  const loading =
    me === undefined ||
    registers === undefined ||
    alerts === undefined ||
    inspections === undefined;

  // ── Derived counts ──────────────────────────────────────────────────────

  const registerCounts = {
    current: 0,
    expiring_soon: 0,
    expired: 0,
    missing: 0,
    review_due: 0,
  };

  if (registers) {
    for (const r of registers) {
      const s = r.status as RegisterStatus;
      if (s in registerCounts) registerCounts[s]++;
    }
  }

  const openAlerts = alerts ? alerts.filter((a) => a.status === "open") : [];

  const nowMs = Date.now();
  const overdueInspections = inspections
    ? inspections.filter(
        (i) => i.status === "in_progress" && i.dueAt !== undefined && i.dueAt < nowMs,
      )
    : [];

  // Registers that need attention
  const attentionRegisters = registers
    ? registers.filter(
        (r) =>
          r.status === "expired" ||
          r.status === "expiring_soon" ||
          r.status === "review_due",
      )
    : [];

  // ── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-8 py-10">
        <PageHeader />
        <div className="mt-8 grid grid-cols-4 gap-4">
          {["a", "b", "c", "d"].map((k) => (
            <div
              key={k}
              className="h-28 animate-pulse rounded-xl border border-border bg-white"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <PageHeader />

      {/* Summary tiles */}
      <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <SummaryTile
          label="Current registers"
          count={registerCounts.current}
          icon={CheckCircle2}
          tone="emerald"
        />
        <SummaryTile
          label="Expiring soon"
          count={registerCounts.expiring_soon + registerCounts.review_due}
          icon={Clock}
          tone="amber"
        />
        <SummaryTile
          label="Expired"
          count={registerCounts.expired}
          icon={ShieldAlert}
          tone="rose"
        />
        <SummaryTile
          label="Open alerts"
          count={openAlerts.length}
          icon={AlertTriangle}
          tone={openAlerts.length > 0 ? "amber" : "neutral"}
        />
      </div>

      {/* Registers needing attention */}
      <section className="mt-10">
        <h2 className="font-montserrat text-base font-bold tracking-tight">
          Registers needing attention
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Expired, expiring soon, or due for review.
        </p>

        {attentionRegisters.length === 0 ? (
          <EmptyCard message="No registers need attention right now. Everything is current." />
        ) : (
          <div className="mt-4 overflow-hidden rounded-xl border border-border bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Label</th>
                  <th className="px-5 py-3 font-medium">Type</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 text-right font-medium">Expires</th>
                </tr>
              </thead>
              <tbody>
                {attentionRegisters.map((r) => (
                  <tr
                    key={r._id}
                    className="border-b border-border last:border-0 hover:bg-neutral-50"
                  >
                    <td className="px-5 py-3.5 font-medium text-neutral-900">
                      {r.label}
                    </td>
                    <td className="px-5 py-3.5 capitalize text-muted-foreground">
                      {r.registerType}
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
      </section>

      {/* Open alerts */}
      <section className="mt-10">
        <h2 className="font-montserrat text-base font-bold tracking-tight">
          Open alerts
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Alerts raised by the daily currency sweep — dismiss once resolved.
        </p>

        {openAlerts.length === 0 ? (
          <EmptyCard message="No open alerts. Run a currency sweep to check for new issues." />
        ) : (
          <div className="mt-4 overflow-hidden rounded-xl border border-border bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Message</th>
                  <th className="px-5 py-3 font-medium">Kind</th>
                  <th className="px-5 py-3 font-medium">Severity</th>
                  <th className="px-5 py-3 text-right font-medium">Raised</th>
                </tr>
              </thead>
              <tbody>
                {openAlerts.map((a) => (
                  <tr
                    key={a._id}
                    className="border-b border-border last:border-0 hover:bg-neutral-50"
                  >
                    <td className="max-w-xs px-5 py-3.5 text-neutral-800">
                      {a.message}
                    </td>
                    <td className="px-5 py-3.5 capitalize text-muted-foreground">
                      {a.kind.replace("_", " ")}
                    </td>
                    <td className="px-5 py-3.5">
                      <SeverityChip severity={a.severity} />
                    </td>
                    <td className="px-5 py-3.5 text-right text-muted-foreground">
                      {formatDate(a.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Overdue inspections */}
      {overdueInspections.length > 0 && (
        <section className="mt-10">
          <h2 className="font-montserrat text-base font-bold tracking-tight">
            Overdue inspections
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            In-progress inspections that have passed their due date.
          </p>
          <div className="mt-4 overflow-hidden rounded-xl border border-border bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Form</th>
                  <th className="px-5 py-3 font-medium">Inspector</th>
                  <th className="px-5 py-3 text-right font-medium">Due</th>
                </tr>
              </thead>
              <tbody>
                {overdueInspections.map((i) => (
                  <tr
                    key={i._id}
                    className="border-b border-border last:border-0 hover:bg-neutral-50"
                  >
                    <td className="px-5 py-3.5 font-medium text-neutral-900">
                      {i.templateName}
                    </td>
                    <td className="px-5 py-3.5 text-muted-foreground">
                      {i.inspectorName}
                    </td>
                    <td className="px-5 py-3.5 text-right text-rose-600">
                      {formatDate(i.dueAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function PageHeader() {
  return (
    <header className="mb-2">
      <h1 className="font-montserrat text-2xl font-bold tracking-tight">
        Compliance
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Org-wide safety health at a glance — registers, alerts, and overdue items.
      </p>
    </header>
  );
}

function EmptyCard({ message }: { message: string }) {
  return (
    <div className="mt-4 rounded-xl border border-dashed border-border bg-white px-8 py-10 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

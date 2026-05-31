"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";
import { Trash2 } from "lucide-react";

/**
 * Testing helper — clears demo activity (inspections, actions, issues, audit log)
 * for the seeded org so onboarding / empty-state flows can be re-run. Templates and
 * the signed-in user are kept.
 */
export default function ResetDemoZone() {
  const resetActivity = useMutation(api.dev.resetActivity);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const onReset = async () => {
    if (
      !window.confirm(
        "Reset demo data? This deletes all inspections, corrective actions, issues and audit history for the demo org. Templates and your sign-in stay.",
      )
    )
      return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await resetActivity();
      setMsg(
        `Cleared ${r.cleared.inspections} inspections, ${r.cleared.actions} actions, ${r.cleared.issues} issues.`,
      );
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Reset failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-12 rounded-xl border border-rose-200 bg-rose-50/40 p-5">
      <h2 className="font-montserrat text-sm font-semibold text-rose-900">
        Danger zone
      </h2>
      <p className="mt-1 text-sm text-rose-700/80">
        Clear all demo activity so you can test onboarding from a clean slate.
        Templates and your sign-in are kept.
      </p>
      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={onReset}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg border border-rose-300 bg-white px-3.5 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" />
          {busy ? "Resetting…" : "Reset demo data"}
        </button>
        {msg && <span className="text-sm text-rose-700">{msg}</span>}
      </div>
    </section>
  );
}

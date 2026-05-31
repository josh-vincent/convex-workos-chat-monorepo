"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { ChevronLeft } from "lucide-react";
import { useBeacon } from "@/hooks/useBeacon";
import { typeLabel } from "@/lib/beacon-ui";

type Question = {
  id: string;
  label: string;
  type: string;
  required?: boolean;
  helpText?: string;
  options?: string[];
};
type Section = { id?: string; title: string; questions: Question[] };

export default function TemplateStructurePage() {
  const params = useParams<{ id: string }>();
  const templateId = params.id as Id<"templates">;
  const router = useRouter();
  const me = useBeacon();
  const ensureUser = useMutation(api.me.ensureUser);
  const start = useMutation(api.inspections.start);
  const [starting, setStarting] = useState(false);

  const data = useQuery(api.templates.getWithVersion, { templateId });

  const onStart = async () => {
    if (!me?.orgId || starting) return;
    setStarting(true);
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
      setStarting(false);
    }
  };

  if (data === undefined) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-10">
        <div className="h-8 w-64 animate-pulse rounded bg-neutral-200" />
      </div>
    );
  }
  if (data === null || !data.template) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-10 text-sm text-muted-foreground">
        Template not found.{" "}
        <Link href="/office/templates" className="underline">
          Back to library
        </Link>
      </div>
    );
  }

  const { template, version } = data;
  const sections = (version?.sections ?? []) as unknown as Section[];
  const questionCount = sections.reduce((n, s) => n + s.questions.length, 0);

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <Link
        href="/office/templates"
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-neutral-900"
      >
        <ChevronLeft className="h-4 w-4" /> Form library
      </Link>

      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-montserrat text-2xl font-bold tracking-tight">
            {template.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {[template.category, template.industry].filter(Boolean).join(" · ")} ·
            v{template.currentVersion} · {sections.length} sections ·{" "}
            {questionCount} questions
          </p>
        </div>
        <button
          type="button"
          onClick={onStart}
          disabled={starting}
          className="shrink-0 rounded-lg bg-neutral-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          {starting ? "Starting…" : "Start inspection"}
        </button>
      </header>

      <div className="space-y-6">
        {sections.map((section, si) => (
          <section
            key={section.id ?? si}
            className="overflow-hidden rounded-xl border border-border bg-white"
          >
            <div className="flex items-center gap-3 border-b border-border bg-neutral-50 px-5 py-3">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-neutral-900 text-xs font-semibold text-white">
                {si + 1}
              </span>
              <h2 className="font-medium text-neutral-900">{section.title}</h2>
              <span className="ml-auto text-xs text-muted-foreground">
                {section.questions.length} items
              </span>
            </div>
            <ul className="divide-y divide-border">
              {section.questions.map((q) => (
                <li
                  key={q.id}
                  className="flex items-start justify-between gap-4 px-5 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-neutral-900">
                      {q.label}
                      {q.required && (
                        <span className="ml-1 text-rose-500" title="Required">
                          *
                        </span>
                      )}
                    </p>
                    {q.helpText && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {q.helpText}
                      </p>
                    )}
                    {q.options && q.options.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {q.options.map((o) => (
                          <span
                            key={o}
                            className="rounded-md bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600"
                          >
                            {o}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <span className="shrink-0 whitespace-nowrap text-xs font-medium text-muted-foreground">
                    {typeLabel(q.type)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

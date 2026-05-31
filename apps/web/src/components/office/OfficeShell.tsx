"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardCheck, FileText, MessageSquare, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { useWebAuth } from "@/app/auth-provider";

const NAV = [
  { href: "/office", label: "Inspections", icon: ClipboardCheck, exact: true },
  { href: "/office/templates", label: "Templates", icon: FileText },
];

function isActive(pathname: string, href: string, exact?: boolean) {
  return exact ? pathname === href : pathname.startsWith(href);
}

/**
 * Office console shell — a fixed left rail for staff who triage inspections and
 * forms from a desk, distinct from the conversational chat surface.
 */
export default function OfficeShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user, logout } = useWebAuth();

  return (
    <div className="flex h-screen bg-neutral-50 text-foreground">
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-white">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-900 text-white">
            <ShieldCheck className="h-4.5 w-4.5" strokeWidth={2.2} />
          </span>
          <div className="leading-tight">
            <div className="font-montserrat text-[15px] font-bold tracking-tight">
              Beacon
            </div>
            <div className="text-[11px] text-muted-foreground">Safety Office</div>
          </div>
        </div>

        <nav className="flex flex-col gap-0.5 px-3 py-2">
          {NAV.map(({ href, label, icon: Icon, exact }) => {
            const active = isActive(pathname, href, exact);
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                  active
                    ? "bg-neutral-900 font-medium text-white"
                    : "text-neutral-600 hover:bg-neutral-100"
                }`}
              >
                <Icon className="h-4 w-4" strokeWidth={2} />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto px-3 py-3">
          <Link
            href="/"
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-100"
          >
            <MessageSquare className="h-4 w-4" strokeWidth={2} />
            Assistant
          </Link>
          <div className="mt-2 flex items-center justify-between border-t border-border px-3 pt-3">
            <span className="truncate text-xs text-muted-foreground">
              {user?.email || user?.name || "Guest"}
            </span>
            <button
              type="button"
              onClick={() => void logout()}
              className="shrink-0 text-xs font-medium text-neutral-500 hover:text-neutral-900"
            >
              Sign out
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}

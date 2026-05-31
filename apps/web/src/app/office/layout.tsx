import type { ReactNode } from "react";
import AuthGuard from "@/components/AuthGuard";
import OfficeShell from "@/components/office/OfficeShell";

export default function OfficeLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard>
      <OfficeShell>{children}</OfficeShell>
    </AuthGuard>
  );
}

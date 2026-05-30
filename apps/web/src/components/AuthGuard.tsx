"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useWebAuth } from "@/app/auth-provider";

/**
 * Client-side route guard. Redirects unauthenticated visitors to /sign-in.
 * Used instead of middleware protection because "guest" sessions authenticate
 * through a Convex JWT rather than a WorkOS session cookie.
 */
export default function AuthGuard({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useWebAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace("/sign-in");
    }
  }, [isLoading, isAuthenticated, router]);

  if (isLoading || !isAuthenticated) return null;

  return <>{children}</>;
}

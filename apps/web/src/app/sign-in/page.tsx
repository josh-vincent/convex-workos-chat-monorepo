"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useWebAuth } from "../auth-provider";

export default function SignInPage() {
  const router = useRouter();
  const { loginAsGuest } = useWebAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onGuest = async () => {
    setLoading(true);
    setError(null);
    try {
      await loginAsGuest();
      router.push("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Guest login failed");
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#EDEDED] px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm">
        <h1 className="text-center text-2xl font-semibold text-[#2D2D2D]">
          Log in to Chat
        </h1>
        <p className="mt-2 text-center text-sm text-gray-500">
          Use WorkOS, or continue as a guest to try the app.
        </p>

        <div className="mt-8 flex flex-col gap-3">
          <Link
            href="/auth/sign-in"
            className="flex h-11 items-center justify-center rounded-lg bg-[#0D87E1] text-center font-montserrat text-white"
          >
            Continue with WorkOS
          </Link>

          <button
            type="button"
            onClick={onGuest}
            disabled={loading}
            className="flex h-11 items-center justify-center rounded-lg border border-[#D0D5DD] font-montserrat text-[#344054] disabled:opacity-60"
          >
            {loading ? "Signing in…" : "Continue as guest"}
          </button>
        </div>

        {error ? (
          <p className="mt-4 text-center text-sm text-red-500">{error}</p>
        ) : null}

        <p className="mt-6 text-center text-xs text-gray-400">
          Guest mode requires{" "}
          <code className="rounded bg-gray-100 px-1">pnpm setup:mock-auth</code>
        </p>
      </div>
    </main>
  );
}

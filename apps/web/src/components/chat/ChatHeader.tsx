"use client";

import Link from "next/link";
import { useWebAuth } from "@/app/auth-provider";

export default function ChatHeader() {
  const { user, isGuest, logout } = useWebAuth();

  return (
    <header className="flex h-14 items-center justify-between border-b border-black/10 bg-white px-4">
      <span className="font-montserrat text-lg font-semibold text-[#2D2D2D]">
        Chat
      </span>
      <div className="flex items-center gap-3">
        <Link
          href="/office"
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-[#344054] hover:bg-gray-50"
        >
          Office
        </Link>
        <span className="text-sm text-gray-500">
          {user?.email || user?.name || (isGuest ? "Guest" : "")}
        </span>
        <button
          type="button"
          onClick={() => void logout()}
          className="rounded-lg border border-[#D0D5DD] px-3 py-1.5 text-sm text-[#344054] hover:bg-gray-50"
        >
          Sign out
        </button>
      </div>
    </header>
  );
}

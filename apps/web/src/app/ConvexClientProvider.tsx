"use client";

import { type ReactNode } from "react";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithAuth } from "convex/react";
import { useAuthForConvex } from "./auth-provider";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

if (!convexUrl)
  throw new Error("Missing NEXT_PUBLIC_CONVEX_URL for the web Convex client");

const convex = new ConvexReactClient(convexUrl);

export default function ConvexClientProvider({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <ConvexProviderWithAuth client={convex} useAuth={useAuthForConvex}>
      {children}
    </ConvexProviderWithAuth>
  );
}

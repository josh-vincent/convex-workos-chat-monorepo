import { type ReactNode } from "react";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithAuth } from "convex/react";
import {
  WorkOSAuthProvider,
  useAuthForConvex,
} from "@/auth/WorkOSAuthProvider";

const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL;

if (!convexUrl)
  throw new Error(
    "Missing EXPO_PUBLIC_CONVEX_URL for the native Convex client",
  );

const convex = new ConvexReactClient(convexUrl);

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return (
    <WorkOSAuthProvider>
      <ConvexProviderWithAuth client={convex} useAuth={useAuthForConvex}>
        {children}
      </ConvexProviderWithAuth>
    </WorkOSAuthProvider>
  );
}

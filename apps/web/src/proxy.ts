import { authkitProxy } from "@workos-inc/authkit-nextjs";
import { NextResponse } from "next/server";

// Manages the WorkOS AuthKit session (cookie refresh, token rotation).
// Route protection is handled client-side (see AuthGuard) because "guest" mode
// authenticates via a Convex JWT rather than a WorkOS session cookie.
//
// When WorkOS isn't configured we pass requests through untouched, so the app
// still runs in guest-only mode without WorkOS credentials.
const workosConfigured = Boolean(
  process.env.WORKOS_API_KEY && process.env.WORKOS_CLIENT_ID,
);

export default workosConfigured ? authkitProxy() : () => NextResponse.next();

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};

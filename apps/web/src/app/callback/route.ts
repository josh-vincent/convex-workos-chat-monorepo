import { handleAuth } from "@workos-inc/authkit-nextjs";

// WorkOS redirects here after a hosted sign-in. Must match
// NEXT_PUBLIC_WORKOS_REDIRECT_URI (e.g. http://localhost:3000/callback).
export const GET = handleAuth({ returnPathname: "/" });

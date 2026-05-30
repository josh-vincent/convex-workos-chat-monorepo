"use server";

import { signOut } from "@workos-inc/authkit-nextjs";

/** Clears the WorkOS session cookie and redirects home. */
export async function signOutAction() {
  await signOut({ returnTo: "/" });
}

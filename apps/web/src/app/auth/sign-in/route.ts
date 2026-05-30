import { getSignInUrl } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";

// Kicks off the WorkOS hosted sign-in flow.
export const GET = async () => {
  const signInUrl = await getSignInUrl();
  return redirect(signInUrl);
};

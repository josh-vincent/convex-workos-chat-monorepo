import { useEffect } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";

/**
 * Resolves the signed-in (WorkOS/guest) identity to a Beacon org + inspector user.
 * Provisions the user on first call, then returns the reactive { orgId, userId, ready }.
 */
export function useBeacon() {
  const ensureUser = useMutation(api.me.ensureUser);
  const me = useQuery(api.me.current);

  useEffect(() => {
    if (me && !me.ready) {
      void ensureUser().catch(() => {});
    }
  }, [me, ensureUser]);

  return me; // undefined = loading, null = signed out, else { orgId, userId, ... }
}

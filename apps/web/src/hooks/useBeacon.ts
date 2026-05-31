"use client";

import { useEffect } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";

/**
 * Bridges the signed-in web user to a Beacon org + user (see convex/me.ts).
 * Provisions the user once on mount, then returns the reactive identity.
 *
 *   undefined → still loading
 *   null      → not authenticated
 *   object    → { orgId, userId, name, email, ready }
 */
export function useBeacon() {
  const ensureUser = useMutation(api.me.ensureUser);
  const me = useQuery(api.me.current);

  useEffect(() => {
    // Once authenticated but not yet provisioned in the demo org, create the user.
    if (me && !me.ready) {
      void ensureUser().catch(() => {});
    }
  }, [me, ensureUser]);

  return me;
}

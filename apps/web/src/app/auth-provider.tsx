"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useAuth, useAccessToken } from "@workos-inc/authkit-nextjs/components";
import { signOutAction } from "./actions";

/**
 * Unifies the two auth modes the app supports:
 *
 *   - WorkOS AuthKit (real auth) — session managed by AuthKitProvider / middleware.
 *   - Mock "guest" mode — a signed JWT minted by the Convex /guest-login endpoint.
 *
 * Both modes are surfaced through a single `convexAuth` object shaped exactly the
 * way ConvexProviderWithAuth expects, plus user/login/logout helpers for the UI.
 *
 * Guest activation lives in localStorage and is read via useSyncExternalStore so
 * it survives reloads and stays consistent between server and client renders.
 */

const GUEST_ID_KEY = "convex-guest-id";
const GUEST_ACTIVE_KEY = "convex-guest-active";
const GUEST_EVENT = "convex-guest-change";

export function convexSiteUrl() {
  // Local Convex deployments serve HTTP actions on a different *port*, so allow
  // an explicit override; otherwise derive the `.convex.site` domain.
  if (process.env.NEXT_PUBLIC_CONVEX_SITE_URL)
    return process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("Missing NEXT_PUBLIC_CONVEX_URL");
  return url.replace(/\.convex\.cloud$/, ".convex.site");
}

function getOrCreateGuestId() {
  let id = localStorage.getItem(GUEST_ID_KEY);
  if (!id) {
    id = `guest_${crypto.randomUUID()}`;
    localStorage.setItem(GUEST_ID_KEY, id);
  }
  return id;
}

function subscribeToGuest(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(GUEST_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(GUEST_EVENT, callback);
  };
}

function getGuestSnapshot() {
  return localStorage.getItem(GUEST_ACTIVE_KEY) === "1";
}

function getGuestServerSnapshot() {
  return false;
}

function setGuestActive(active: boolean) {
  if (active) localStorage.setItem(GUEST_ACTIVE_KEY, "1");
  else localStorage.removeItem(GUEST_ACTIVE_KEY);
  window.dispatchEvent(new Event(GUEST_EVENT));
}

type ConvexAuth = {
  isLoading: boolean;
  isAuthenticated: boolean;
  fetchAccessToken: (opts: {
    forceRefreshToken: boolean;
  }) => Promise<string | null>;
};

type WebUser = { name: string; email: string; image: string };

type WebAuth = {
  isLoading: boolean;
  isAuthenticated: boolean;
  isGuest: boolean;
  user: WebUser | null;
  loginAsGuest: () => Promise<void>;
  logout: () => Promise<void>;
  convexAuth: ConvexAuth;
  // Current access token for authenticating direct calls (e.g. the chat stream).
  getToken: () => Promise<string | null>;
};

const WebAuthContext = createContext<WebAuth | null>(null);

export function WebAuthProvider({ children }: { children: ReactNode }) {
  const { user, loading: userLoading } = useAuth();
  const { accessToken, loading: tokenLoading, refresh } = useAccessToken();

  const isGuest = useSyncExternalStore(
    subscribeToGuest,
    getGuestSnapshot,
    getGuestServerSnapshot,
  );

  const guestTokenRef = useRef<string | null>(null);
  const accessTokenRef = useRef<string | null>(null);

  // Keep the WorkOS token reachable from the stable fetchAccessToken callback.
  useEffect(() => {
    accessTokenRef.current = accessToken ?? null;
  }, [accessToken]);

  const fetchGuestToken = useCallback(async () => {
    const subject = getOrCreateGuestId();
    const res = await fetch(`${convexSiteUrl()}/guest-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Guest login failed (${res.status}): ${detail}`);
    }
    const { token } = (await res.json()) as { token: string };
    guestTokenRef.current = token;
    return token;
  }, []);

  const loginAsGuest = useCallback(async () => {
    await fetchGuestToken();
    setGuestActive(true);
  }, [fetchGuestToken]);

  const logout = useCallback(async () => {
    if (isGuest) {
      guestTokenRef.current = null;
      setGuestActive(false);
      window.location.href = "/";
      return;
    }
    await signOutAction();
  }, [isGuest]);

  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
      if (getGuestSnapshot()) {
        if (forceRefreshToken || !guestTokenRef.current) {
          return await fetchGuestToken();
        }
        return guestTokenRef.current;
      }
      if (forceRefreshToken) {
        try {
          await refresh();
        } catch {
          // refresh failures surface as an unauthenticated state below
        }
      }
      return accessTokenRef.current;
    },
    [fetchGuestToken, refresh],
  );

  const value = useMemo<WebAuth>(() => {
    const isLoading = !isGuest && (userLoading || tokenLoading);
    const isAuthenticated = isGuest || !!user;
    const webUser: WebUser | null = user
      ? {
          name:
            [user.firstName, user.lastName].filter(Boolean).join(" ") ||
            user.email ||
            "Account",
          email: user.email ?? "",
          image: user.profilePictureUrl ?? "",
        }
      : isGuest
        ? { name: "Guest", email: "", image: "" }
        : null;

    return {
      isLoading,
      isAuthenticated,
      isGuest,
      user: webUser,
      loginAsGuest,
      logout,
      convexAuth: { isLoading, isAuthenticated, fetchAccessToken },
      getToken: () => fetchAccessToken({ forceRefreshToken: false }),
    };
  }, [
    isGuest,
    userLoading,
    tokenLoading,
    user,
    loginAsGuest,
    logout,
    fetchAccessToken,
  ]);

  return (
    <WebAuthContext.Provider value={value}>{children}</WebAuthContext.Provider>
  );
}

export function useWebAuth() {
  const ctx = useContext(WebAuthContext);
  if (!ctx)
    throw new Error("useWebAuth must be used within a <WebAuthProvider>");
  return ctx;
}

/** Hook passed to ConvexProviderWithAuth. */
export function useAuthForConvex() {
  return useWebAuth().convexAuth;
}

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as AuthSession from "expo-auth-session";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";

WebBrowser.maybeCompleteAuthSession();

/**
 * Native auth for the Expo app. WorkOS has no drop-in Expo SDK, so we implement:
 *
 *   - WorkOS AuthKit hosted login via the OAuth Authorization Code + PKCE flow
 *     (expo-auth-session opens the hosted UI; we exchange the code for tokens).
 *     Enabled when EXPO_PUBLIC_WORKOS_CLIENT_ID is set.
 *   - Mock "guest" login via the Convex /guest-login endpoint (works with no
 *     WorkOS credentials — handy for local development).
 *
 * Tokens are persisted in expo-secure-store and surfaced to Convex through the
 * `fetchAccessToken` contract expected by ConvexProviderWithAuth.
 */

const WORKOS_CLIENT_ID = process.env.EXPO_PUBLIC_WORKOS_CLIENT_ID ?? "";
const CONVEX_URL = process.env.EXPO_PUBLIC_CONVEX_URL ?? "";

// Base URL is overridable so we can point at a local WorkOS emulator
// (agent-emulate) instead of the real api.workos.com.
const WORKOS_BASE =
  process.env.EXPO_PUBLIC_WORKOS_BASE_URL ?? "https://api.workos.com";
const WORKOS_AUTHORIZE = `${WORKOS_BASE}/user_management/authorize`;
// Real WorkOS uses /user_management/authenticate; the emulator uses
// /user_management/authenticate/code — both accept the same JSON body.
const WORKOS_AUTHENTICATE = `${WORKOS_BASE}${
  process.env.EXPO_PUBLIC_WORKOS_TOKEN_PATH ?? "/user_management/authenticate"
}`;

const STORE_MODE = "auth.mode"; // "workos" | "guest"
const STORE_WORKOS_ACCESS = "auth.workos.access";
const STORE_WORKOS_REFRESH = "auth.workos.refresh";
const STORE_WORKOS_USER = "auth.workos.user";
const STORE_GUEST_SUBJECT = "auth.guest.subject";

function convexSiteUrl() {
  // Local Convex deployments serve HTTP actions on a different *port* (not a
  // `.site` domain), so allow an explicit override for dev.
  if (process.env.EXPO_PUBLIC_CONVEX_SITE_URL)
    return process.env.EXPO_PUBLIC_CONVEX_SITE_URL;
  if (!CONVEX_URL) throw new Error("Missing EXPO_PUBLIC_CONVEX_URL");
  return CONVEX_URL.replace(/\.convex\.cloud$/, ".convex.site");
}

const redirectUri = AuthSession.makeRedirectUri({
  scheme: "chat",
  path: "callback",
});

export type AuthUser = {
  name: string;
  email: string;
  image: string;
};

type WorkOSUser = {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  profile_picture_url?: string | null;
};

function toAuthUser(u: WorkOSUser): AuthUser {
  return {
    name:
      [u.first_name, u.last_name].filter(Boolean).join(" ") ||
      u.email ||
      "Account",
    email: u.email ?? "",
    image: u.profile_picture_url ?? "",
  };
}

type AuthContextValue = {
  isLoading: boolean;
  isAuthenticated: boolean;
  isGuest: boolean;
  user: AuthUser | null;
  workosEnabled: boolean;
  signInWithWorkOS: () => Promise<void>;
  loginAsGuest: () => Promise<void>;
  signOut: () => Promise<void>;
  // Passed to ConvexProviderWithAuth.
  fetchAccessToken: (opts: {
    forceRefreshToken: boolean;
  }) => Promise<string | null>;
  // Current access token for authenticating direct HTTP calls (e.g. the chat stream).
  getToken: () => Promise<string | null>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function WorkOSAuthProvider({ children }: { children: ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  const [mode, setMode] = useState<"workos" | "guest" | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);

  const accessTokenRef = useRef<string | null>(null);
  const refreshTokenRef = useRef<string | null>(null);
  const guestSubjectRef = useRef<string | null>(null);
  const guestTokenRef = useRef<string | null>(null);

  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: WORKOS_CLIENT_ID,
      redirectUri,
      responseType: AuthSession.ResponseType.Code,
      scopes: ["openid", "profile", "email", "offline_access"],
      usePKCE: true,
      extraParams: { provider: "authkit" },
    },
    { authorizationEndpoint: WORKOS_AUTHORIZE },
  );

  // Restore any persisted session on mount.
  useEffect(() => {
    (async () => {
      try {
        const savedMode = (await SecureStore.getItemAsync(STORE_MODE)) as
          | "workos"
          | "guest"
          | null;
        if (savedMode === "workos") {
          accessTokenRef.current =
            await SecureStore.getItemAsync(STORE_WORKOS_ACCESS);
          refreshTokenRef.current =
            await SecureStore.getItemAsync(STORE_WORKOS_REFRESH);
          const userJson = await SecureStore.getItemAsync(STORE_WORKOS_USER);
          if (accessTokenRef.current) {
            if (userJson) setUser(JSON.parse(userJson));
            setMode("workos");
          }
        } else if (savedMode === "guest") {
          guestSubjectRef.current =
            await SecureStore.getItemAsync(STORE_GUEST_SUBJECT);
          if (guestSubjectRef.current) {
            setUser({ name: "Guest", email: "", image: "" });
            setMode("guest");
          }
        }
      } finally {
        setHydrated(true);
      }
    })();
  }, []);

  const exchangeCode = useCallback(
    async (code: string, codeVerifier: string) => {
      const res = await fetch(WORKOS_AUTHENTICATE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: WORKOS_CLIENT_ID,
          grant_type: "authorization_code",
          code,
          code_verifier: codeVerifier,
        }),
      });
      if (!res.ok) {
        throw new Error(`WorkOS token exchange failed (${res.status})`);
      }
      const data = (await res.json()) as {
        access_token: string;
        refresh_token?: string;
        user: WorkOSUser;
      };
      accessTokenRef.current = data.access_token;
      refreshTokenRef.current = data.refresh_token ?? null;
      const authUser = toAuthUser(data.user);
      setUser(authUser);
      setMode("workos");
      await SecureStore.setItemAsync(STORE_MODE, "workos");
      await SecureStore.setItemAsync(STORE_WORKOS_ACCESS, data.access_token);
      if (data.refresh_token)
        await SecureStore.setItemAsync(
          STORE_WORKOS_REFRESH,
          data.refresh_token,
        );
      await SecureStore.setItemAsync(
        STORE_WORKOS_USER,
        JSON.stringify(authUser),
      );
    },
    [],
  );

  // Complete the WorkOS flow once the browser returns a code.
  useEffect(() => {
    if (response?.type === "success" && request?.codeVerifier) {
      const code = response.params.code;
      if (code) {
        exchangeCode(code, request.codeVerifier).catch((e) =>
          console.error("WorkOS sign-in failed", e),
        );
      }
    }
  }, [response, request, exchangeCode]);

  const refreshWorkOSToken = useCallback(async () => {
    if (!refreshTokenRef.current) return accessTokenRef.current;
    const res = await fetch(WORKOS_AUTHENTICATE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: WORKOS_CLIENT_ID,
        grant_type: "refresh_token",
        refresh_token: refreshTokenRef.current,
      }),
    });
    if (!res.ok) return accessTokenRef.current;
    const data = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
    };
    accessTokenRef.current = data.access_token;
    await SecureStore.setItemAsync(STORE_WORKOS_ACCESS, data.access_token);
    if (data.refresh_token) {
      refreshTokenRef.current = data.refresh_token;
      await SecureStore.setItemAsync(STORE_WORKOS_REFRESH, data.refresh_token);
    }
    return accessTokenRef.current;
  }, []);

  const fetchGuestToken = useCallback(async () => {
    let subject = guestSubjectRef.current;
    if (!subject) {
      subject = `guest_${randomGuestId()}`;
      guestSubjectRef.current = subject;
      await SecureStore.setItemAsync(STORE_GUEST_SUBJECT, subject);
    }
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

  const signInWithWorkOS = useCallback(async () => {
    if (!WORKOS_CLIENT_ID) {
      throw new Error(
        "WorkOS is not configured. Set EXPO_PUBLIC_WORKOS_CLIENT_ID to enable hosted sign-in.",
      );
    }
    await promptAsync();
  }, [promptAsync]);

  const loginAsGuest = useCallback(async () => {
    await fetchGuestToken();
    await SecureStore.setItemAsync(STORE_MODE, "guest");
    setUser({ name: "Guest", email: "", image: "" });
    setMode("guest");
  }, [fetchGuestToken]);

  const signOut = useCallback(async () => {
    accessTokenRef.current = null;
    refreshTokenRef.current = null;
    guestTokenRef.current = null;
    await Promise.all([
      SecureStore.deleteItemAsync(STORE_MODE),
      SecureStore.deleteItemAsync(STORE_WORKOS_ACCESS),
      SecureStore.deleteItemAsync(STORE_WORKOS_REFRESH),
      SecureStore.deleteItemAsync(STORE_WORKOS_USER),
    ]);
    setUser(null);
    setMode(null);
  }, []);

  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
      if (mode === "guest") {
        if (forceRefreshToken || !guestTokenRef.current) {
          return await fetchGuestToken();
        }
        return guestTokenRef.current;
      }
      if (mode === "workos") {
        if (forceRefreshToken) return await refreshWorkOSToken();
        return accessTokenRef.current;
      }
      return null;
    },
    [mode, fetchGuestToken, refreshWorkOSToken],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      isLoading: !hydrated,
      isAuthenticated: mode !== null,
      isGuest: mode === "guest",
      user,
      workosEnabled: Boolean(WORKOS_CLIENT_ID),
      signInWithWorkOS,
      loginAsGuest,
      signOut,
      fetchAccessToken,
      getToken: () => fetchAccessToken({ forceRefreshToken: false }),
    }),
    [
      hydrated,
      mode,
      user,
      signInWithWorkOS,
      loginAsGuest,
      signOut,
      fetchAccessToken,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx)
    throw new Error("useAuth must be used within a <WorkOSAuthProvider>");
  return ctx;
}

/** Hook passed to ConvexProviderWithAuth. */
export function useAuthForConvex() {
  const { isLoading, isAuthenticated, fetchAccessToken } = useAuth();
  return useMemo(
    () => ({ isLoading, isAuthenticated, fetchAccessToken }),
    [isLoading, isAuthenticated, fetchAccessToken],
  );
}

// Lightweight random id without pulling in extra deps.
function randomGuestId() {
  return (
    Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
  );
}

import { type AuthConfig } from "convex/server";

/**
 * Convex validates incoming JWTs against these providers. We register up to two:
 *
 *  1. WorkOS AuthKit (real auth) — enabled when WORKOS_JWT_ISSUER + WORKOS_JWKS_URL
 *     are set in the Convex deployment env. WorkOS access tokens are RS256 JWTs.
 *     NOTE: WorkOS access tokens often do NOT include an `aud` claim. Only set
 *     WORKOS_JWT_AUDIENCE if your AuthKit environment is configured to emit one;
 *     otherwise verification relies on the issuer + JWKS signature.
 *
 *  2. Mock "guest" provider (local dev) — enabled when MOCK_JWT_PUBLIC_JWK is set
 *     (run `pnpm setup:mock-auth`). The JWKS is inlined as a data URI so the guest
 *     issuer needs no public endpoint. Guest tokens are minted by the /guest-login
 *     HTTP action in http.ts and always carry `aud: "convex"`.
 *
 * `issuer` must match the JWT `iss` claim exactly, and `applicationID` (when set)
 * must match the `aud` claim exactly.
 */

type Provider = AuthConfig["providers"][number];

const providers: Provider[] = [];

const workosIssuer = process.env.WORKOS_JWT_ISSUER;
const workosJwks = process.env.WORKOS_JWKS_URL;
if (workosIssuer && workosJwks) {
  providers.push({
    type: "customJwt",
    issuer: workosIssuer,
    jwks: workosJwks,
    algorithm: "RS256",
    ...(process.env.WORKOS_JWT_AUDIENCE
      ? { applicationID: process.env.WORKOS_JWT_AUDIENCE }
      : {}),
  } as Provider);
}

const mockPublicJwk = process.env.MOCK_JWT_PUBLIC_JWK;
if (mockPublicJwk) {
  const jwksJson = JSON.stringify({ keys: [JSON.parse(mockPublicJwk)] });
  providers.push({
    type: "customJwt",
    issuer: process.env.MOCK_JWT_ISSUER ?? "https://guest.convex.local",
    applicationID: "convex",
    jwks: `data:application/json;charset=utf-8,${encodeURIComponent(jwksJson)}`,
    algorithm: "RS256",
  } as Provider);
}

export default { providers } satisfies AuthConfig;

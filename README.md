# Cross-Platform AI Chat Template

A modern TypeScript monorepo for a streaming **AI chat app** on web and native,
sharing one backend. Designed to run fully **offline for local dev** — no AI
provider key, no WorkOS account required.

Stack:

- [Turborepo](https://turbo.build/repo) + [pnpm](https://pnpm.io/)
- [Next.js 16](https://nextjs.org/) (App Router) — `apps/web`
- [Expo SDK 56](https://docs.expo.dev/) (Expo Router) — `apps/native`
- [React 19](https://react.dev/)
- [Convex](https://convex.dev/) — backend + the streaming `/chat` HTTP action
- [AI SDK v5](https://sdk.vercel.dev/) via the [Vercel AI Gateway](https://vercel.com/docs/ai-gateway)
- [WorkOS AuthKit](https://workos.com/docs/authkit) — auth, with a built-in
  **guest** login and an offline **WorkOS emulator** for local dev

## What's inside

- `apps/web` — Next.js chat app (`useChat` → Convex `/chat`)
- `apps/native` — Expo chat app (based on `EvanBacon/chat-template`)
- `packages/backend` — Convex: `auth.config.ts`, and `http.ts` exposing
  `POST /guest-login` (mints guest JWTs) and `POST /chat` (auth-gated AI stream)

Both apps share the same Convex `/chat` endpoint and the same WorkOS + guest auth
model. Chat is stateless (messages live client-side via `useChat`); add Convex
tables in `schema.ts` to persist threads.

## Quick start

### 1. Install

```sh
pnpm install
```

### 2. Provision Convex + guest auth

```sh
pnpm --filter @packages/backend setup   # leave running; logs in & configures the deployment
pnpm setup:mock-auth                     # in a SECOND terminal
```

`setup` configures the deployment and writes `packages/backend/.env.local`. It
keeps retrying the first push until the auth env vars exist — so run
`setup:mock-auth` (second terminal) to seed them. It generates a dev RSA keypair
+ empty WorkOS placeholders, after which the push succeeds.

> Order matters: `auth.config.ts` references the WorkOS env vars, so Convex won't
> deploy until they're set (even to empty). `setup:mock-auth` handles that and
> enables the **Continue as guest** button (a real, Convex-verified JWT — no auth
> provider needed). For a local-only deployment, prefix both with
> `CONVEX_AGENT_MODE=anonymous`.

### 4. AI inference (optional key)

`POST /chat` streams via the Vercel AI Gateway (model `anthropic/claude-haiku-4.5`).
Set the key in the **Convex** env for real responses:

```sh
# in packages/backend: npx convex env set AI_GATEWAY_API_KEY <key>
```

Without a key, `/chat` streams a **mocked** reply over the same protocol — so the
full client → Convex → stream pipeline works with zero external dependencies.

### 5. WorkOS (optional — real auth)

Set these **Convex** env vars so the backend trusts WorkOS access tokens:

```sh
WORKOS_JWT_ISSUER=https://api.workos.com/user_management/client_xxx
WORKOS_JWKS_URL=https://api.workos.com/sso/jwks/client_xxx
```

Then fill the app env files (below). Redirect URIs: `http://localhost:3000/callback`
(web) and `chat://callback` (native).

> **Offline tip:** `agent-emulate` (a dev dependency) ships a WorkOS emulator.
> Run `npx agent-emulate -s workos`, point `WORKOS_JWT_ISSUER`/`WORKOS_JWKS_URL`
> at `http://localhost:4000/...`, and set `EXPO_PUBLIC_WORKOS_BASE_URL=http://localhost:4000`
> to exercise the full WorkOS flow with no real account.

### 6. App env files

Copy each `.example.env` to `.env.local`:

- `NEXT_PUBLIC_CONVEX_URL` / `EXPO_PUBLIC_CONVEX_URL` ← from `packages/backend/.env.local`.
- For local Convex deployments, also set `NEXT_PUBLIC_CONVEX_SITE_URL` /
  `EXPO_PUBLIC_CONVEX_SITE_URL` (HTTP actions are on a different port).
- WorkOS web: `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`, `WORKOS_COOKIE_PASSWORD`
  (32+ chars), `NEXT_PUBLIC_WORKOS_REDIRECT_URI`.
- WorkOS native: `EXPO_PUBLIC_WORKOS_CLIENT_ID` (+ `EXPO_PUBLIC_WORKOS_BASE_URL`
  for the emulator).
- Leave WorkOS values blank to use **guest only**.

### 7. Run

```sh
pnpm dev          # backend + web via Turbo
```

> The native app uses native modules (`@expo/ui`, glass effects), so it needs a
> **custom dev build** — `cd apps/native && npx expo run:ios` (Expo Go won't load it).

## Architecture notes

- Auth is bridged into Convex via `ConvexProviderWithAuth` in each app's Convex
  provider, backed by `apps/web/src/app/auth-provider.tsx` and
  `apps/native/src/auth/WorkOSAuthProvider.tsx` (both expose `getToken()`).
- `apps/web/src/proxy.ts` runs the WorkOS AuthKit middleware (passthrough when
  WorkOS isn't configured); routes are gated client-side by `AuthGuard` so guest
  sessions (a Convex JWT, not a WorkOS cookie) are covered too.
- The chat clients attach the WorkOS/guest token on every `/chat` request; the
  Convex action verifies it with `ctx.auth.getUserIdentity()` before streaming.

## Tooling

- `biome` — linter (Prettier remains the formatter): `npx biome lint`
- `fallow` — dead-code / dependency analysis: `npx fallow dead-code`
- `agent-emulate` — offline service emulators (WorkOS, etc.)
- `expo-mcp` — Expo MCP server for editor/agent integration

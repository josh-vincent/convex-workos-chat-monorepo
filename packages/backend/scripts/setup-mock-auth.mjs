#!/usr/bin/env node
// Generates a dev RSA keypair for the mock "guest" auth provider and stores it
// in the Convex deployment env. Run after `npx convex dev` has provisioned a
// deployment:  pnpm setup:mock-auth   (from repo root or packages/backend)
//
// Sets these Convex env vars:
//   MOCK_JWT_PRIVATE_KEY  (PKCS#8 PEM — used by /guest-login to sign tokens)
//   MOCK_JWT_PUBLIC_JWK   (public JWK — inlined into auth.config.ts JWKS)
//   MOCK_JWT_KID          (key id)
//   MOCK_JWT_ISSUER       (issuer string shared by signer + verifier)
//
// The private key never touches the repo or the client — only the Convex env.

import { generateKeyPairSync, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

const ISSUER = "https://guest.convex.local";
const KID = `mock-guest-${randomUUID().slice(0, 8)}`;

console.log("Generating RS256 keypair for mock guest auth…");
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});

const privatePem = privateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString();
const jwk = publicKey.export({ format: "jwk" });
jwk.kid = KID;
jwk.alg = "RS256";
jwk.use = "sig";

const envVars = {
  // base64 so the value is single-line (Convex env set chokes on multiline PEM).
  MOCK_JWT_PRIVATE_KEY: Buffer.from(privatePem).toString("base64"),
  MOCK_JWT_PUBLIC_JWK: JSON.stringify(jwk),
  MOCK_JWT_KID: KID,
  MOCK_JWT_ISSUER: ISSUER,
};

function setEnv(name, value) {
  console.log(`Setting Convex env var ${name}…`);
  const result = spawnSync("npx", ["convex", "env", "set", name, value], {
    stdio: ["ignore", "inherit", "inherit"],
  });
  if (result.status !== 0) {
    console.error(
      `\nFailed to set ${name}. Make sure you've run \`npx convex dev\` first ` +
        `to provision a deployment, then re-run \`pnpm setup:mock-auth\`.`,
    );
    process.exit(result.status ?? 1);
  }
}

function getEnv(name) {
  const res = spawnSync("npx", ["convex", "env", "get", name], {
    encoding: "utf8",
  });
  return res.status === 0 ? res.stdout.trim() : "";
}

for (const [name, value] of Object.entries(envVars)) {
  setEnv(name, value);
}

// auth.config.ts references the WorkOS vars too, and Convex requires every
// referenced env var to be set (even behind a conditional). Seed empty
// placeholders for guest-only mode, but never clobber real WorkOS config.
for (const name of ["WORKOS_JWT_ISSUER", "WORKOS_JWKS_URL", "WORKOS_JWT_AUDIENCE"]) {
  if (!getEnv(name)) setEnv(name, "");
}

console.log(
  "\n✅ Mock guest auth is configured. The “Continue as guest” button now works.",
);

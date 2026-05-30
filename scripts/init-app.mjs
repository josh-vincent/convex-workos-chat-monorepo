#!/usr/bin/env node
// Personalize this template for a new app. Renames the app identity only —
// it never touches the `/chat` endpoint, `useChat`, or `ChatHeader`/component names.
//
//   pnpm init:app                                   # interactive
//   pnpm init:app -- "Acme Chat" acmechat com.acme.chat
//
// Replaces the placeholders: name/slug/scheme "chat", bundle id "com.example.chat",
// the web <title>/sign-in heading "Chat", and the monorepo package name.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const slugify = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 40) || "app";

function replace(rel, find, repl, { all = false } = {}) {
  const p = resolve(root, rel);
  const src = readFileSync(p, "utf8");
  if (!src.includes(find)) {
    console.warn(`  ! "${find}" not found in ${rel} (already renamed?) — skipped`);
    return;
  }
  writeFileSync(p, all ? src.split(find).join(repl) : src.replace(find, repl));
  console.log(`  ✓ ${rel}`);
}

async function main() {
  let [displayName, scheme, bundleId] = process.argv.slice(2);
  if (!displayName || !scheme || !bundleId) {
    const rl = createInterface({ input, output });
    displayName =
      displayName || (await rl.question("App display name (e.g. Acme Chat): ")).trim() || "My App";
    scheme =
      scheme ||
      slugify(
        (await rl.question(`URL scheme / slug [${slugify(displayName)}]: `)).trim() ||
          slugify(displayName),
      );
    bundleId =
      bundleId ||
      (await rl.question(`Bundle id / package [com.example.${scheme}]: `)).trim() ||
      `com.example.${scheme}`;
    rl.close();
  }
  scheme = slugify(scheme);
  if (!/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/.test(bundleId)) {
    console.error(`Invalid bundle id "${bundleId}" (expected reverse-domain, e.g. com.acme.chat)`);
    process.exit(1);
  }

  console.log(`\nPersonalizing -> name="${displayName}", scheme="${scheme}", id="${bundleId}"\n`);

  // Native app identity (app.json)
  replace("apps/native/app.json", '"name": "chat"', `"name": "${displayName}"`);
  replace("apps/native/app.json", '"slug": "chat"', `"slug": "${scheme}"`);
  replace("apps/native/app.json", '"scheme": "chat"', `"scheme": "${scheme}"`);
  replace("apps/native/app.json", "com.example.chat", bundleId, { all: true });

  // Native deep-link scheme must match app.json
  replace(
    "apps/native/src/auth/WorkOSAuthProvider.tsx",
    'scheme: "chat",',
    `scheme: "${scheme}",`,
  );

  // Web titles
  replace("apps/web/src/app/layout.tsx", 'title: "Chat",', `title: ${JSON.stringify(displayName)},`);
  replace("apps/web/src/app/sign-in/page.tsx", "Log in to Chat", `Log in to ${displayName}`);

  // Monorepo name
  replace("package.json", '"name": "convex-monorepo"', `"name": "${scheme}"`);

  console.log(`\n✅ Done. Next steps:
  pnpm install
  pnpm --filter @packages/backend setup     # + pnpm setup:mock-auth (2nd terminal)
  pnpm dev
  # native identity changed -> rebuild: (cd apps/native && npx expo prebuild --clean && npx expo run:ios)\n`);
}

main();

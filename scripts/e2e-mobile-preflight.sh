#!/usr/bin/env bash
# E2E mobile preflight — observe & report only (no edits, no code changes).
# Verifies the safety-inspection app is ready for an on-device Argent test and
# prints the facts a (Haiku) QA agent needs: ports, demo org id, seeded forms,
# guest-login health, and which simulators are free vs. in use.
#
# Usage:
#   scripts/e2e-mobile-preflight.sh                  # assumes Convex API:3210 / site:3211
#   API_PORT=3212 SITE_PORT=3213 scripts/e2e-mobile-preflight.sh
set -uo pipefail

API_PORT="${API_PORT:-3210}"
SITE_PORT="${SITE_PORT:-3211}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/packages/backend"
FORMS=("Daily Site Safety Walk" "Forklift Pre-Start Check" "Working at Heights Permit")
ok=0; warn=0

say()  { printf '%s\n' "$*"; }
pass() { printf '  ✓ %s\n' "$*"; }
fail() { printf '  ✗ %s\n' "$*"; warn=$((warn+1)); }

say "── E2E mobile preflight ───────────────────────────────"
say "Convex API=http://127.0.0.1:$API_PORT  site=http://127.0.0.1:$SITE_PORT"

# 1. Backend reachable
if curl -s -o /dev/null --max-time 3 "http://127.0.0.1:$API_PORT/version"; then
  pass "Convex backend reachable on $API_PORT"
else
  fail "Convex backend NOT reachable on $API_PORT — start: (cd packages/backend && CONVEX_AGENT_MODE=anonymous npx convex dev)"
  say  "  (set API_PORT/SITE_PORT if your deployment landed on another pair)"
fi

# 2. Guest login (mints the JWT the apps use)
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -X POST \
  "http://127.0.0.1:$SITE_PORT/guest-login" -H 'Content-Type: application/json' \
  -d '{"subject":"preflight"}')"
[ "$code" = "200" ] && pass "guest-login OK on $SITE_PORT (200)" || fail "guest-login returned $code on $SITE_PORT"

# 3. Demo org + seeded forms
# `convex data` prints a table; the demo org row contains "<id>" ... "northwind".
ORG="$(cd "$BACKEND" && CONVEX_AGENT_MODE=anonymous npx convex data organizations 2>/dev/null \
  | python3 -c "import sys,re
for line in sys.stdin:
    if 'northwind' in line:
        m=re.search(r'\"([a-z0-9]{16,})\"', line)
        if m: print(m.group(1)); break" 2>/dev/null)"
if [ -n "$ORG" ]; then
  pass "Demo org 'northwind' seeded → $ORG"
  # Capture to a file and grep -aF: the template JSON contains em-dashes, which makes
  # grep treat piped stdin as "binary" and silently miss matches.
  tmpl="$(mktemp)"
  (cd "$BACKEND" && CONVEX_AGENT_MODE=anonymous npx convex run templates:list "{\"orgId\":\"$ORG\"}" 2>/dev/null) > "$tmpl"
  for f in "${FORMS[@]}"; do
    if grep -aqF "$f" "$tmpl"; then pass "form seeded: $f"; else fail "form MISSING: $f  (run: pnpm --filter @packages/backend seed)"; fi
  done
  rm -f "$tmpl"
  say "  EXPORT for verification:  ORG=$ORG"
else
  fail "Demo org 'northwind' not found — run: pnpm --filter @packages/backend seed"
fi

# 4. Metro
if lsof -nP -iTCP:8082 -sTCP:LISTEN >/dev/null 2>&1; then pass "Metro listening on 8082"; else say "  • Metro 8082 not up — start: (cd apps/native && RCT_METRO_PORT=8082 npx expo run:ios --device <UDID> --port 8082)"; fi

# 5. Simulators (prefer a CLEAN, idle device — never one another project is driving)
say "── Simulators ─────────────────────────────────────────"
xcrun simctl list devices 2>/dev/null | grep -iE "Booted" | sed 's/^/  BOOTED  /' || true
say "  (boot an idle one with: xcrun simctl boot <UDID> && open -a Simulator)"

say "───────────────────────────────────────────────────────"
if [ "$warn" -eq 0 ]; then say "READY ✓  — drive the flow per AGENTS.md §3.2"; else say "NOT READY — $warn check(s) failed (see ✗ above)"; fi

#!/usr/bin/env bash
# Runs alcyone with cf dev, its local bucket, and no Access, and drives it in Chromium with
# Playwright: two tabs on one board, as two people (test/browser/collaborate.mjs). It
# writes screenshots to test/browser/out/, with the log of cf dev in dev.log.
#
# Needs the example settings in alcyone.config.ts, the dependencies of the project and of
# test/browser, and Chromium for Playwright.
set -euo pipefail

root=$(cd "$(dirname "$0")/../.." && pwd)
out="$root/test/browser/out"
base=http://localhost:5173
mkdir -p "$out"
cd "$root"

pnpm exec cf dev >"$out/dev.log" 2>&1 &
dev=$!
trap 'kill "$dev" 2>/dev/null || true' EXIT

for _ in $(seq 120); do
  curl -fsS "$base/api/me" >/dev/null 2>&1 && break
  sleep 1
done
if ! curl -fsS "$base/api/me"; then
  echo "cf dev did not answer at $base" >&2
  cat "$out/dev.log" >&2
  exit 1
fi
echo

node "$root/test/browser/collaborate.mjs" "$base" "$out"

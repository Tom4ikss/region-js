#!/usr/bin/env bash
# Fetches V8 at the commit the patch is based on, applies the regions patch
# and builds d8 into v8-src/v8/out/release. Takes a while and ~10 GB of disk.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASE="$(cat "$ROOT/v8/BASE")"
export PATH="$ROOT/depot_tools:$PATH"

if [ ! -d "$ROOT/depot_tools" ]; then
  git clone --depth 1 https://chromium.googlesource.com/chromium/tools/depot_tools.git "$ROOT/depot_tools"
fi

mkdir -p "$ROOT/v8-src"
cd "$ROOT/v8-src"
if [ ! -d v8 ]; then
  fetch --no-history v8
fi
gclient sync --no-history --revision "v8@$BASE"

cd v8
if git apply --check "$ROOT/v8/regions.patch" 2>/dev/null; then
  git apply "$ROOT/v8/regions.patch"
else
  echo "The patch does not apply: is v8-src/v8 already patched or at another commit?" >&2
  git apply --reverse --check "$ROOT/v8/regions.patch" && echo "(it is already applied)" >&2
fi

gn gen out/release --args="$(cat "$ROOT/v8/args.gn")"
autoninja -C out/release d8
out/release/d8 --harmony-regions -e 'print("regions:", typeof Region, typeof spawn, typeof Channel)'

#!/usr/bin/env bash
# Fetches V8 at the commit the patch is based on, applies the regions patch
# and builds d8. Takes a while and ~15 GB of disk.
#
#   scripts/setup.sh                       # out/release: release build with DCHECKs
#   scripts/setup.sh tsan is_tsan=true     # another out dir with extra gn args
#   JOBS=8 scripts/setup.sh                # limit parallel jobs (machines with little RAM)
#
# Extra gn args are appended to v8/args.gn. Running it again skips the fetch
# and the patch if they are already done and only builds.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASE="$(cat "$ROOT/v8/BASE")"
OUT="${1:-release}"
shift || true
export PATH="$ROOT/depot_tools:$PATH"

if [ ! -d "$ROOT/depot_tools" ]; then
  git clone --depth 1 https://chromium.googlesource.com/chromium/tools/depot_tools.git "$ROOT/depot_tools"
fi

mkdir -p "$ROOT/v8-src"
cd "$ROOT/v8-src"
if [ ! -d v8 ]; then
  fetch --no-history v8
  gclient sync --no-history --revision "v8@$BASE"
fi

cd v8
if git apply --check "$ROOT/v8/regions.patch" 2>/dev/null; then
  git apply "$ROOT/v8/regions.patch"
elif git apply --reverse --check "$ROOT/v8/regions.patch" 2>/dev/null; then
  echo "The patch is already applied."
else
  echo "The patch does not apply: is v8-src/v8 at another commit or changed by hand?" >&2
  exit 1
fi

ARGS="$(cat "$ROOT/v8/args.gn")"
for arg in "$@"; do ARGS="$ARGS
$arg"; done
gn gen "out/$OUT" --args="$ARGS"
autoninja ${JOBS:+-j "$JOBS"} -C "out/$OUT" d8
"out/$OUT/d8" --harmony-regions -e 'print("regions:", typeof Region, typeof spawn, typeof Channel)'

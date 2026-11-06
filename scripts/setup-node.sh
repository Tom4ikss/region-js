#!/usr/bin/env bash
# Fetches Node.js at the commit in node/BASE (nodejs/node-v8, which ships the
# V8 version of v8/BASE), applies the regions patch to deps/v8 and
# node/node.patch to Node itself, and builds node. Linux x64 for now. Takes a
# while and ~10 GB of disk.
#
#   scripts/setup-node.sh              # node-src/out/Release/node
#   JOBS=8 scripts/setup-node.sh       # limit parallel jobs (machines with little RAM)
#   CC=clang-20 CXX=clang++-20 scripts/setup-node.sh
#
# Needs clang 19.1 or newer, Python 3 and ninja. Running it again skips the
# fetch and the patches if they are already done and only builds.
#
# The build: pointer compression in one shared cage, so that every worker
# shares one heap with the others (without a shared cage each worker gets a
# heap of its own and regions cannot cross threads), with the sandbox off and
# with DCHECKs, like v8/args.gn. Temporal is off: it needs a Rust toolchain.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASE="$(cat "$ROOT/node/BASE")"
SRC="$ROOT/node-src"
export CC="${CC:-clang}" CXX="${CXX:-clang++}"

if [ ! -d "$SRC/.git" ]; then
  git init -q "$SRC"
  git -C "$SRC" fetch --depth 1 https://github.com/nodejs/node-v8.git "$BASE"
  git -C "$SRC" checkout -q FETCH_HEAD
fi

cd "$SRC"
apply() {
  if git apply --check "$@" 2>/dev/null; then
    git apply "$@"
  elif git apply --reverse --check "$@" 2>/dev/null; then
    echo "Already applied: ${*: -1}"
  else
    echo "Does not apply: ${*: -1}. Is node-src at another commit or changed by hand?" >&2
    exit 1
  fi
}
apply --directory=deps/v8 "$ROOT/v8/regions.patch"
apply "$ROOT/node/node.patch"

if [ ! -f out/Release/build.ninja ]; then
  ./configure --ninja --v8-with-dchecks \
    --experimental-enable-pointer-compression \
    --experimental-pointer-compression-shared-cage \
    --v8-disable-temporal-support
fi
ninja ${JOBS:+-j "$JOBS"} -C out/Release node
# Region, Channel and RwLock on every thread, moves between workers in the
# transfer list of postMessage(), and spawn() with a pool of worker_threads.
out/Release/node --harmony-regions -p '"regions: " + typeof Region + ", spawn: " + typeof spawn'

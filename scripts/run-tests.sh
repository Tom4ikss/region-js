#!/usr/bin/env bash
# Runs each tests/*.js once with the flags from its first line and reports
# crashes, failed checks, sanitizer reports and timeouts. Benchmarks are
# skipped. Works with any build, including ASan and TSan ones.
#
#   scripts/run-tests.sh path/to/d8
#   TIMEOUT=1800 TESTS="local-ref.js" scripts/run-tests.sh v8-src/v8/out/tsan/d8
#
# Full outputs go to $LOGS (default: a new directory under /tmp).
set -uo pipefail

D8="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TIMEOUT="${TIMEOUT:-600}"
LOGS="${LOGS:-$(mktemp -d /tmp/region-tests.XXXXXX)}"
mkdir -p "$LOGS"
# Absolute, because the tests run from tests/.
LOGS="$(cd "$LOGS" && pwd)"

# Runs d8 with a deadline; prints its output and "TIMEOUT" if it was killed.
run() {
  "$D8" "$@" 2>&1 &
  local pid=$!
  (sleep "$TIMEOUT"; kill -9 "$pid" 2>/dev/null) </dev/null >/dev/null 2>&1 &
  local watcher=$!
  wait "$pid" 2>/dev/null
  local code=$?
  kill "$watcher" 2>/dev/null
  wait "$watcher" 2>/dev/null
  [ "$code" -eq 137 ] && echo "TIMEOUT after ${TIMEOUT}s"
  return 0
}

BAD='Flag processing error|^FAIL|TIMEOUT|unhandled|Check failed|Fatal|Debug check|Received signal|Segmentation|Sanitizer|^[^ ]+:[0-9]+: [A-Za-z]*Error'

cd "$ROOT/tests"
total=0
failed=0
start=$(date +%s)
# shellcheck disable=SC2086
for test in ${TESTS:-*.js}; do
  case "$test" in
    bench*|fuzz.js|ping-pong.js|port-stress.js|offload.js|hot-*.js|literals-fast.js|spawn-pool.js) continue ;;
  esac
  flags=$(head -1 "$test" | sed -n 's|^// d8 \(.*\) [^ ]*\.js.*$|\1|p')
  [ -z "$flags" ] && flags="--harmony-regions"
  # Builds without DCHECKs have no --verify-heap.
  # shellcheck disable=SC2086
  if run $flags -e 0 | grep -q "Flag processing error"; then
    flags=${flags//--verify-heap/}
  fi
  t0=$(date +%s)
  # shellcheck disable=SC2086
  run $flags "$test" > "$LOGS/$test.log" || { echo "cannot write $LOGS/$test.log" >&2; exit 2; }
  total=$((total + 1))
  bad=$(grep -E "$BAD" "$LOGS/$test.log" | head -3)
  if [ -n "$bad" ]; then
    failed=$((failed + 1))
    echo "=== $test ($(( $(date +%s) - t0 ))s)"
    echo "$bad"
  fi
done

echo
echo "$failed of $total tests reported problems in $(( ($(date +%s) - start) / 60 )) min; logs in $LOGS"

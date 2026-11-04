#!/usr/bin/env bash
# Runs tests/*.js under the flag sets V8's own test runner calls variants:
# other tiers, no JIT, GC stress. Each output is compared with the run without
# extra flags, after dropping timing lines and region and isolate numbers,
# which change with GC timing. Crashes, failed checks and timeouts are
# reported too.
#
#   scripts/test-variants.sh path/to/d8 [variant ...]
#   TESTS="local-ref.js region-fn.js" scripts/test-variants.sh path/to/d8 jitless
#
# A test lists variants it is not meant for in a "// skip-variants: ..." line,
# with the reason next to it. Without variants, runs all of them; that takes
# hours on a release build with DCHECKs. Variants: jitless no-lfa sparkplug no-maglev stress-maglev
# minor-ms stress-gc gc-interval single-threaded-gc concurrent-alloc
# concurrent-inlining.
set -uo pipefail

D8="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
shift
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TIMEOUT="${TIMEOUT:-600}"

variant_flags() {
  case "$1" in
    jitless) echo "--jitless" ;;
    no-lfa) echo "--no-lazy-feedback-allocation" ;;
    sparkplug) echo "--always-sparkplug" ;;
    no-maglev) echo "--no-maglev" ;;
    stress-maglev) echo "--stress-maglev" ;;
    minor-ms) echo "--minor-ms" ;;
    stress-gc) echo "--stress-compaction --stress-incremental-marking" ;;
    gc-interval) echo "--gc-interval=500" ;;
    single-threaded-gc) echo "--single-threaded-gc" ;;
    concurrent-alloc) echo "--stress-concurrent-allocation" ;;
    concurrent-inlining) echo "--stress-concurrent-inlining" ;;
    *) echo "unknown variant: $1" >&2; exit 2 ;;
  esac
}

if [ $# -eq 0 ]; then
  set -- jitless no-lfa sparkplug no-maglev stress-maglev minor-ms stress-gc \
    gc-interval single-threaded-gc concurrent-alloc concurrent-inlining
fi
for variant in "$@"; do variant_flags "$variant" >/dev/null || exit 2; done

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

normalize() {
  grep -vE '[0-9] ?(ms|мс|µs|us|ns|мкс)\b|took|elapsed|time' |
    sed -E 's/region [0-9]+/region N/g; s/isolate [0-9]+/isolate N/g; s/markings [0-9]+ pages [0-9]+/markings N pages N/g'
}

BAD='Flag processing error|^FAIL|TIMEOUT|unhandled|Check failed|Fatal|Debug check|Received signal|Segmentation|AddressSanitizer|ThreadSanitizer'

cd "$ROOT/tests"
variants=("$@")
failures=()
skipped=()
for i in "${!variants[@]}"; do failures[$i]=0; skipped[$i]=0; done
total=0
# shellcheck disable=SC2086
for test in ${TESTS:-*.js}; do
  case "$test" in
    bench*|fuzz.js|ping-pong.js|port-stress.js|offload.js|hot-*.js|literals-fast.js|spawn-pool.js) continue ;;
  esac
  flags=$(head -1 "$test" | sed -n 's|^// d8 \(.*\) [^ ]*\.js.*$|\1|p')
  [ -z "$flags" ] && flags="--harmony-regions"
  skip=" $(sed -n 's|^// skip-variants: ||p' "$test" | head -1) "
  # Builds without DCHECKs have no --verify-heap.
  # shellcheck disable=SC2086
  if run $flags -e 0 | grep -q "Flag processing error"; then
    flags=${flags//--verify-heap/}
  fi
  # shellcheck disable=SC2086
  expected=$(run $flags "$test" | normalize)
  total=$((total + 1))
  for i in "${!variants[@]}"; do
    variant=${variants[$i]}
    if [[ "$skip" == *" $variant "* ]]; then
      skipped[$i]=$((skipped[$i] + 1))
      continue
    fi
    # shellcheck disable=SC2086
    actual=$(run $flags $(variant_flags "$variant") "$test" | normalize)
    bad=$(echo "$actual" | grep -E "$BAD" | head -3)
    if [ -n "$bad" ] || [ "$actual" != "$expected" ]; then
      failures[$i]=$((failures[$i] + 1))
      echo "=== $test [$variant]"
      if [ -n "$bad" ]; then
        echo "$bad"
      else
        diff <(echo "$expected") <(echo "$actual") | head -8
      fi
    fi
  done
done

echo
for i in "${!variants[@]}"; do
  ran=$((total - skipped[$i]))
  echo "${variants[$i]}: ${failures[$i]} of $ran differ$([ "${skipped[$i]}" -gt 0 ] && echo ", ${skipped[$i]} skipped")"
done

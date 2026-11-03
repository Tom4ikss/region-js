#!/usr/bin/env bash
# Downloads the prebuilt d8 for Linux x64 from a GitHub release (the latest one
# by default), checks its SHA-256 and installs it into .d8/, with a `d8`
# wrapper in ~/.local/bin. Used by the Codespaces setup; works on any Linux x64.
#
#   scripts/get-d8.sh            # latest release
#   TAG=v0.5.0-alpha scripts/get-d8.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO=https://github.com/Tom4ikss/region-js
ARCHIVE=region-js-d8-linux-x64.tar.gz
if [ -n "${TAG:-}" ]; then
  URL="$REPO/releases/download/$TAG/$ARCHIVE"
else
  URL="$REPO/releases/latest/download/$ARCHIVE"
fi

if [ "$(uname -s)-$(uname -m)" != "Linux-x86_64" ]; then
  echo "Prebuilt d8 exists only for Linux x64; elsewhere build it with scripts/setup.sh." >&2
  exit 1
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl -fsSL -o "$tmp/$ARCHIVE" "$URL"
curl -fsSL -o "$tmp/$ARCHIVE.sha256" "$URL.sha256"
(cd "$tmp" && sha256sum -c "$ARCHIVE.sha256")

rm -rf "$ROOT/.d8"
mkdir -p "$ROOT/.d8" "$HOME/.local/bin"
tar -C "$ROOT/.d8" -xzf "$tmp/$ARCHIVE"
# A wrapper rather than a symlink: d8 looks for its snapshot next to the path it was started by.
printf '#!/bin/sh\nexec "%s" "$@"\n' "$ROOT/.d8/region-js-d8/d8" > "$HOME/.local/bin/d8"
chmod +x "$HOME/.local/bin/d8"
# The same path a local build has, so the README commands and the playground's run task work.
if [ ! -e "$ROOT/v8-src/v8/out/release/d8" ]; then
  mkdir -p "$ROOT/v8-src/v8/out/release"
  cp "$HOME/.local/bin/d8" "$ROOT/v8-src/v8/out/release/d8"
fi
"$HOME/.local/bin/d8" --harmony-regions -e 'print("d8 with regions:", typeof Region, typeof spawn, typeof Channel)'
head -2 "$ROOT/.d8/region-js-d8/BUILD_INFO"

#!/usr/bin/env bash
# Parses and bundles every Marketplace edge function so a syntax error or a bad
# import fails here instead of at deploy time.
#
# Deno is not required. The remote Deno imports are marked external.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FUNCTIONS_DIR="$REPO_ROOT/fuw marketplace/supabase/functions"
ESBUILD="$REPO_ROOT/fuw marketplace/node_modules/.bin/esbuild"

if [[ ! -x "$ESBUILD" ]]; then
  echo "esbuild not found at $ESBUILD" >&2
  exit 2
fi

mapfile -t SOURCES < <(find "$FUNCTIONS_DIR" -name '*.ts' -not -path '*/node_modules/*' | sort)

if [[ ${#SOURCES[@]} -eq 0 ]]; then
  echo "No edge function sources found in $FUNCTIONS_DIR" >&2
  exit 2
fi

OUT_DIR="$(mktemp -d)"
trap 'rm -rf "$OUT_DIR"' EXIT

echo "Checking ${#SOURCES[@]} edge function source file(s)..."

"$ESBUILD" --bundle --format=esm --platform=neutral \
  --external:'https://esm.sh/*' \
  --outdir="$OUT_DIR" \
  --log-level=warning \
  "${SOURCES[@]}"

echo "PASS: all edge functions parse and bundle."
#!/usr/bin/env bash
set -e
ENTRY="$1"
OUT="node_modules/.cache/qa-$(basename "$ENTRY" .ts).mjs"
npx esbuild "$ENTRY" --bundle --platform=node --format=esm --packages=external \
  --tsconfig=tsconfig.json \
  --define:import.meta.env.DEV=true \
  --define:import.meta.env.VITE_MONDAY_TOKEN=process.env.MONDAY_TOKEN \
  --outfile="$OUT" >/dev/null
echo "$OUT"

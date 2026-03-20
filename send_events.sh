#!/bin/bash

# Load .env.local if running locally (Vercel injects these automatically)
if [ -f "$(dirname "$0")/.env.local" ]; then
  set -a
  source "$(dirname "$0")/.env.local"
  set +a
fi

if [ -z "$SYNCROFY_API_KEY" ] || [ -z "$SYNCROFY_ENDPOINT" ] || [ -z "$SYNCROFY_AUTH_HEADER" ]; then
  echo "Error: SYNCROFY_API_KEY, SYNCROFY_ENDPOINT, and SYNCROFY_AUTH_HEADER must be set"
  exit 1
fi

if [ "$#" -eq 0 ]; then
  set -- "event.json"
fi

for file in "$@"; do
  if [ ! -f "$file" ]; then
    echo "Warning: file not found, skipping: $file"
    continue
  fi

  echo "$file"

  curl -v -m 180 --location "$SYNCROFY_ENDPOINT" \
    --header "$SYNCROFY_AUTH_HEADER: $SYNCROFY_API_KEY" \
    --header 'Content-Type: application/json' \
    --data-binary "@$file"

  grep "coreId" "$file" | sort -u

done
 
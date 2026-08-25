#!/usr/bin/env bash
# Run this yourself, once, after `stellar keys generate relayer/sponsor` have been created.
# Writes RELAYER_SECRET_KEY / SPONSOR_SECRET_KEY into .env. Secrets never pass through Claude.
set -euo pipefail
cd "$(dirname "$0")/.."

RELAYER_SECRET=$(stellar keys show relayer)
SPONSOR_SECRET=$(stellar keys show sponsor)
RELAYER_PUBLIC=$(stellar keys address relayer)
SPONSOR_PUBLIC=$(stellar keys address sponsor)

sed -i '' \
  -e "s#^RELAYER_SECRET_KEY=.*#RELAYER_SECRET_KEY=${RELAYER_SECRET}#" \
  -e "s#^RELAYER_PUBLIC_KEY=.*#RELAYER_PUBLIC_KEY=${RELAYER_PUBLIC}#" \
  -e "s#^SPONSOR_SECRET_KEY=.*#SPONSOR_SECRET_KEY=${SPONSOR_SECRET}#" \
  -e "s#^SPONSOR_PUBLIC_KEY=.*#SPONSOR_PUBLIC_KEY=${SPONSOR_PUBLIC}#" \
  .env

echo "Filled RELAYER_SECRET_KEY, RELAYER_PUBLIC_KEY, SPONSOR_SECRET_KEY, SPONSOR_PUBLIC_KEY in .env"

#!/usr/bin/env bash
# Run this yourself, once, after `stellar keys generate relayer/sponsor` have been created.
# Writes RELAYER_SECRET_KEY / SPONSOR_SECRET_KEY into .env. Secrets never pass through Claude.
#
# Refuses to replace a funded key in .env with an unfunded one from the keystore, and prints
# the public keys it wrote. Both guards exist because the silent version of this script is a
# trap that arms itself at the worst moment: the relayer's own error message recommends running
# it, which is exactly when RELAYER_SECRET_KEY is missing. The resulting failure arrives at
# submission time and reads as a relayer bug rather than a configuration one. See
# docs/EVIDENCE.md §9.
set -euo pipefail
cd "$(dirname "$0")/.."

HORIZON=$(grep -E '^STELLAR_HORIZON_URL=' .env | cut -d= -f2- | tr -d '"')
HORIZON=${HORIZON:-https://horizon-testnet.stellar.org}

# funded <G...> — true when Horizon knows the account
funded() {
  [ -n "${1:-}" ] || return 1
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$HORIZON/accounts/$1")" = "200" ]
}

# check <ROLE> <keystore-name> — refuse a funded -> unfunded swap
check() {
  local role=$1 name=$2 current new
  current=$(grep -E "^${role}_PUBLIC_KEY=" .env | cut -d= -f2-)
  new=$(stellar keys address "$name")
  [ "$current" = "$new" ] && return 0
  if funded "$current" && ! funded "$new"; then
    echo "refusing to overwrite ${role}_PUBLIC_KEY:" >&2
    echo "  .env holds          $current  (funded)" >&2
    echo "  keystore '$name' is $new  (not funded)" >&2
    echo "  Fund it, or point the keystore at the funded key, then re-run." >&2
    return 1
  fi
  return 0
}

failed=0
check RELAYER relayer || failed=1
check SPONSOR sponsor || failed=1
[ "$failed" -eq 0 ] || { echo "Nothing was written." >&2; exit 1; }

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

echo "Wrote to .env (secret keys not shown):"
echo "  RELAYER_PUBLIC_KEY=${RELAYER_PUBLIC}"
echo "  SPONSOR_PUBLIC_KEY=${SPONSOR_PUBLIC}"

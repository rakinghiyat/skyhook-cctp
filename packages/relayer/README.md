# @skyhook/relayer

Drives one CCTP burn to completion on Stellar.

Nothing executes a Skyhook instruction on its own. Circle's `CctpForwarder` *credits* the
recipient rather than invoking it, so an arriving transfer sits inert until someone submits
`Skyhook.execute`. That is this tool's entire job.

**Running one is permissionless.** The relayer takes no custody of the USDC being transferred and
holds no user funds. Its only cost is the fee for the single invocation it submits, paid from its
own account. Skyhook depends on the role existing, not on any particular operator — anyone can
run this against any burn.

## Usage

```
npm install                       # from the repo root; workspaces wire the packages together
node packages/relayer/src/cli.js <burnTxHash>
```

`<burnTxHash>` is the transaction on the source chain that burned the USDC.

## What it does

1. **Polls Circle for the attestation**, backing off between attempts — 2s doubling to a 30s
   ceiling. Circle rate-limits this API, so widening the gap is the correct response to pressure,
   not retrying harder.
2. **Reads the message itself.** Circle's Get Messages endpoint returns `recipient`,
   `destinationCaller` and `mintRecipient` as **null** for every Stellar message — the API cannot
   tell a 32-byte account from a 32-byte contract. The values are in the raw hex the whole time,
   so the relayer parses them out and prints what it recovered.
3. **Re-attests if the message never reached finality.** A fast transfer whose attestation expired
   is upgraded via `POST /v2/reattest/{nonce}`. A message already attested as finalized is left
   alone, and the log says so rather than implying a recovery that did not happen.
4. **Submits `Skyhook.execute`** and waits for confirmation.

## Configuration

Read from the repo-root `.env`:

| Variable | Purpose |
|---|---|
| `CIRCLE_ATTESTATION_API` | Circle's attestation service |
| `SOURCE_DOMAIN_ID` | CCTP domain of the source chain |
| `STELLAR_RPC_URL` | Soroban RPC endpoint |
| `SKYHOOK_CORE_ID` | The core contract to submit to |
| `RELAYER_SECRET_KEY` | Pays the invocation fee. Populate with `./scripts/fill-stellar-keys.sh` |

## If attestation fetches fail TLS verification

Some networks intercept DNS for entire domains and answer with their own filter, which then
presents its own certificate — `fetch` fails with `CERT_HAS_EXPIRED` or similar. The relayer
detects that, re-resolves over DNS-over-HTTPS, and dials the real address with the correct SNI.

**Certificate verification stays on throughout.** Pinned resolution changes which address is
dialled, never whether the peer is trusted — an attestation authorizes a mint, so this path must
never be "fixed" by disabling verification. On a normal network none of it engages.

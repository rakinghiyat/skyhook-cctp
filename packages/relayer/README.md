# @skyhook/relayer

Takes one CCTP burn all the way to Stellar.

A Skyhook instruction doesn't run by itself. Circle's `CctpForwarder` only *credits* the
recipient and never calls it, so an arriving transfer just sits there until someone submits
`Skyhook.execute`. That's this tool's job.

**Anyone can run one.** The relayer never holds the USDC or any user funds. It only pays the fee
for the one call it submits, from its own account. Skyhook needs someone to relay, not a specific
operator, so anyone can run this for any burn.

## Usage

```
npm install                       # from the repo root; workspaces wire the packages together
node packages/relayer/src/cli.js <burnTxHash>
```

`<burnTxHash>` is the transaction on the source chain that burned the USDC.

## What it does

1. **Polls Circle for the attestation**, backing off from 2s up to 30s between attempts. Circle
   rate-limits this API, so slowing down is the right response.
2. **Reads the message itself.** Circle's API returns `recipient`, `destinationCaller` and
   `mintRecipient` as **null** for every Stellar message, because it can't tell an account from a
   contract. The values are in the raw hex, so the relayer reads them and prints what it found.
3. **Re-attests if the message never reached finality.** A fast transfer whose attestation
   expired is upgraded with `POST /v2/reattest/{nonce}`. If the message is already finalized,
   it's left alone and the log says so.
4. **Submits `Skyhook.execute`** and waits for confirmation.

## Configuration

Read from the repo-root `.env`:

| Variable | Purpose |
|---|---|
| `CIRCLE_ATTESTATION_API` | Circle's attestation service |
| `SOURCE_DOMAIN_ID` | CCTP domain of the source chain |
| `STELLAR_RPC_URL` | Soroban RPC endpoint |
| `SKYHOOK_CORE_ID` | The core contract to submit to |
| `RELAYER_SECRET_KEY` | Pays the invocation fee. Fill it with `./scripts/fill-stellar-keys.sh` |

## If attestation fetches fail TLS verification

Some networks hijack DNS for whole domains and return their own filter, which shows its own
certificate, so `fetch` fails with `CERT_HAS_EXPIRED` or similar. The relayer detects this,
resolves the name over DNS-over-HTTPS, and connects to the real address with the right SNI.

**Certificate checks stay on the whole time.** Only the address changes, never whether the peer is
trusted. An attestation authorizes a mint, so never "fix" this by turning verification off. On a
normal network none of this kicks in.

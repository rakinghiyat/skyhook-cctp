# @skyhook-cctp/relayer

Takes one CCTP burn all the way to Stellar.

A Skyhook instruction doesn't run by itself. Circle's `CctpForwarder` only *credits* the
recipient and never calls it, so an arriving transfer just sits there until someone submits
`Skyhook.execute`. That's this tool's job.

**Anyone can run one.** The relayer never holds the USDC or any user funds. It only pays the fee
for the one call it submits, from its own account. Skyhook needs someone to relay, not a specific
operator, so anyone can run this for any burn.

## Usage

```bash
npx @skyhook-cctp/relayer <burnTxHash>
```

`<burnTxHash>` is the transaction on the source chain that burned the USDC.

From a clone of the repository instead:

```bash
npm install                       # from the repo root; workspaces wire the packages together
node packages/relayer/src/cli.js <burnTxHash>
```

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

Read from a `.env` file, which the relayer looks for in the directory you run it in and then
in each directory above it. It prints the one it picked, so there is no guessing which file a
value came from.

| Variable | Purpose |
|---|---|
| `CIRCLE_ATTESTATION_API` | Circle's attestation service |
| `SOURCE_DOMAIN_ID` | CCTP domain of the source chain |
| `STELLAR_RPC_URL` | Soroban RPC endpoint |
| `STELLAR_HORIZON_URL` | Horizon endpoint, used to read the account before submitting |
| `SKYHOOK_CORE_ID` | The core contract to submit to |
| `RELAYER_SECRET_KEY` | Pays the invocation fee, from its own account. Any funded Stellar key. `stellar keys generate my-relayer --network testnet --fund` makes and funds one, then `stellar keys secret my-relayer` prints the `S...` to paste here. In a clone of the repository, `./scripts/fill-stellar-keys.sh` fills it from the Stellar CLI keystore. |

All six are required. A working Testnet `.env`, with Arc as the source chain:

```bash
CIRCLE_ATTESTATION_API=https://iris-api-sandbox.circle.com
SOURCE_DOMAIN_ID=26
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
SKYHOOK_CORE_ID=CCOMST7FEDLYJ5MXZTVKVKMK43AQP2U2AZEZRHE3XHYO6UF6LKC2654F
RELAYER_SECRET_KEY=S...
```

Worth adding one more line even though the relayer ignores it:

```bash
STELLAR_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
```

The relayer defaults to Testnet and never reads it. The Stellar CLI does. Run `stellar contract
invoke` in this directory and it picks up `STELLAR_RPC_URL` from the `.env`, which makes it stop
asking the network preset and start asking for a passphrase. Setting it here means CLI calls and
the relayer work side by side out of the same file.

## If attestation fetches fail TLS verification

Some networks hijack DNS for whole domains and return their own filter, which shows its own
certificate, so `fetch` fails with `CERT_HAS_EXPIRED` or similar. The relayer detects this,
resolves the name over DNS-over-HTTPS, and connects to the real address with the right SNI.

**Certificate checks stay on the whole time.** Only the address changes, never whether the peer is
trusted. An attestation authorizes a mint, so never "fix" this by turning verification off. On a
normal network none of this kicks in.

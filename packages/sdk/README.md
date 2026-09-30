# @skyhook/sdk

Builds the CCTP burn parameters and the Skyhook instruction that travels with them — and reads
the same wire format back.

A sending application uses this to make USDC *do something* when it reaches Stellar, instead of
arriving and sitting there. See the [format reference](../../README.md#instruction-format) for
the bytes this produces.

## Install

```bash
npm install @skyhook/sdk
```

## The shortest path

A transfer that deposits into a SEP-56 vault on arrival, in three steps.

### 1. Build the instruction

```js
import { buildInstruction, depositParams, buildHookData, toHex } from "@skyhook/sdk";

const SKYHOOK_CORE = "CCOMST7FEDLYJ5MXZTVKVKMK43AQP2U2AZEZRHE3XHYO6UF6LKC2654F";
const VAULT        = "CAY6UNOOWATJW2LXFGMTO6NKLJRVWRKMNVZVPGLKRBLE5Y6OFMDF7IB4";
const RECIPIENT    = "GAQB…";  // who ends up holding the vault shares

// handler_id 1 = Deposit; its params are the vault address.
const instruction = buildInstruction(RECIPIENT, 1, depositParams(VAULT));

// Wrap it in Circle's hook frame, addressed to the Skyhook core.
const hookData = toHex(buildHookData(SKYHOOK_CORE, instruction));
```

`buildInstruction` and `depositParams` both reject anything that is not a 56-byte strkey. That
is deliberate: an `L` field that does not describe the strkey exactly is rejected by Circle's
forwarder, and a malformed envelope is the one failure mode whose funds cannot be recovered.

To hold for a recipient rather than deposit, use handler `2` with no params:

```js
const instruction = buildInstruction(RECIPIENT, 2);
```

### 2. Burn on the source chain

Two parameters decide whether the transfer arrives or is lost forever. Circle warns that a wrong
`destinationCaller`, or a `mintRecipient` pointing at anything other than the forwarder contract,
makes funds **permanently stuck and unrecoverable**. `buildBurnParameters` assembles the call and
refuses both, before anything is signed:

```js
import { buildBurnParameters } from "@skyhook/sdk";

const burn = buildBurnParameters({
  amount: 1_000_000n,   // 6 decimals, as USDC is on the source chain
  forwarder: "CA66Q2WFBND6V4UEB7RD4SAXSVIWMD6RA4X3U32ELVFGXV5PJK4T4VSZ",
  forwardRecipient: SKYHOOK_CORE,   // where the instruction is executed
  burnToken: USDC,                  // USDC's address on the source chain
  instruction,                      // from step 1
});

await walletClient.writeContract({
  address: TOKEN_MESSENGER,         // Circle's TokenMessengerV2 on the source chain
  abi: tokenMessengerAbi,
  functionName: "depositForBurnWithHook",
  args: burn.args,                  // already in the ABI's order
});
```

`mintRecipient` and `destinationCaller` both default to `forwarder`, which is the only correct
value for either — you do not pass them. They are still *accepted*, so that a wrong one is caught
rather than impossible to express, and the error names the mistake:

```
mintRecipient is Skyhook's own address. It belongs in forwardRecipient, inside the hook
data — the mint always goes to CctpForwarder (CA66Q2WF…), which then forwards.
```

That is the mistake worth guarding against, because it is the reasonable one: naming the contract
that should act on the funds, on the assumption that this is how you route them there. It is not.
Skyhook's address goes in `forwardRecipient` inside the hook data; the mint always goes to the
forwarder.

Why this is checked here rather than handled later: once the burn is signed, its nonce is spent. A
message that cannot be delivered cannot be retried, refunded or rebuilt, so before signing is the
only moment any of this can be caught.

Prefer to build the call yourself? `burn` also carries each parameter by name — `amount`,
`destinationDomain`, `mintRecipient`, `burnToken`, `destinationCaller`, `maxFee`,
`minFinalityThreshold`, `hookData` — with the addresses already `bytes32`-encoded.

### 3. Relay it

Nothing executes the instruction until someone submits it — the forwarder credits rather than
invokes. Run the [relayer](../relayer/README.md) against the burn:

```bash
node packages/relayer/src/cli.js <burnTxHash>
```

It waits for Circle's attestation, then calls `Skyhook.execute`. Running one is permissionless
and takes no custody; you can run your own or rely on any other operator.

The recipient ends up holding vault shares. **No USDC trustline is required** — shares live in
the vault's own storage, so Deposit reaches recipients that a plain USDC payout cannot.

### 4. Confirm it landed

The relayer prints a transaction hash, but the honest check is the recipient's position, read
back from the vault itself:

```bash
stellar contract invoke --id <vault> --source <any-funded-account> \
  --network testnet --send=no -- balance --account <recipient>
```

It should have risen by the delivered amount, at Stellar's 7 decimals — 1 USDC burned arrives as
`10000000`. Because vault shares are a Soroban token rather than a classic asset, a wallet will
not list them until the vault's contract id is added as a custom token; the balance above is
there either way.

If the instruction fell back to Hold instead, the amount is waiting under the recipient's name:

```bash
stellar contract invoke --id <handler-hold> --source <any-funded-account> \
  --network testnet --send=no -- held --recipient <recipient>
```

Both calls are read-only (`--send=no`), cost nothing, and can be run by anyone — you do not need
the recipient's key to look.

## Reading a message back

Circle's Get Messages endpoint returns **every address field as `null`** for Stellar messages —
the API cannot tell a 32-byte account from a 32-byte contract. The values are in the raw message
the whole time:

```js
import { parseCctpMessage, isFinalized } from "@skyhook/sdk";

const parsed = parseCctpMessage(message);   // raw hex from Circle's `message` field

parsed.recipient                  // recovered, though the API returned null
parsed.body.mintRecipientStrkey   // the same value as a readable C-address
parsed.hook.forwardRecipient      // the Skyhook core this was addressed to
parsed.hook.instruction           // the Skyhook instruction, as hex

isFinalized(parsed);              // false means it may need re-attestation
```

## API

| Export | Purpose |
|---|---|
| `buildInstruction(recipient, handlerId, params?)` | The Skyhook instruction envelope |
| `depositParams(vault)` | Deposit's `params` — the vault address |
| `buildBurnParameters({ … })` | The `depositForBurnWithHook` call, with the unrecoverable addresses refused |
| `buildHookData(forwardRecipient, payload?)` | Circle's hook frame around an instruction |
| `parseCctpMessage(hex)` | A raw CCTP message, fields and all |
| `parseHookData(bytes)` | Just the hook frame |
| `isFinalized(parsed)` | Whether the attestation reached finality |
| `toHex(bytes)` | `0x`-prefixed hex |

## What happens when something goes wrong

Your instruction does not have to be perfect for the funds to be safe — but it does decide how
recoverable they are.

| If | Then |
|---|---|
| The vault address is not a vault, or is for another asset | The handler refuses before collecting; funds route to Hold, claimable by `fallback_recipient` |
| `handler_id` is not registered | Straight to Hold |
| `params_len` disagrees with the bytes present | Straight to Hold |
| The envelope is shorter than 57 bytes, or `fallback_recipient` is not a valid strkey | **The funds become unrecoverable.** No recipient can be read, so they are recorded against the CCTP nonce, and nobody can prove a nonce is theirs |

The last row is why this library validates strkeys instead of trusting the caller. Build the
envelope with `buildInstruction` and it cannot happen.

## Networks

Testnet only for now. The addresses above are Stellar Testnet, paired with Arc Testnet
(CCTP domain 26) as the source chain.

## Development

```bash
npm install          # from the repo root — workspaces wire the packages together
npm test --workspace @skyhook/sdk
```

Tests run against real attested messages captured from Testnet, so the parser is checked against
the wire rather than against a fixture someone wrote to match it.

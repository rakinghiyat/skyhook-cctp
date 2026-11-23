# @skyhook-cctp/sdk

Builds the CCTP burn parameters and the Skyhook instruction that goes with them, and reads the
same format back.

A sending app uses this to make USDC *do something* when it reaches Stellar, instead of just
arriving. See the [format reference](../../README.md#instruction-format) for the exact bytes.

## Install

```bash
npm install @skyhook-cctp/sdk
```

## Before you start

Three things the SDK cannot get for you.

**USDC on the source chain.** Arc Testnet uses USDC as its native gas token, so a single balance
covers both the amount you burn and the fee it costs to burn it. There is no second token to
fund. Get it from [Circle's faucet](https://faucet.circle.com): choose *Arc Testnet*, paste your
address, and it sends 20 USDC. One request per asset and network every two hours. No account is
needed, but there is a reCAPTCHA, so it cannot be scripted into your setup.

> Some ISPs DNS-hijack `faucet.circle.com` to a national block page. It surfaces as a **TLS
> certificate error** rather than anything that says "blocked", so it reads as a broken site
> rather than a filtered one. The block is DNS-only: resolving through 1.1.1.1, 8.8.8.8 or
> 9.9.9.9 reaches the real host.

**A funded Stellar account** for whoever submits the execution, because the relayer pays the
Soroban fee. [Friendbot](https://friendbot.stellar.org) funds an address on Testnet, but it can't
invent one, so make the key first. The Stellar CLI below does both, and prints the `S...` secret
the relayer wants in `RELAYER_SECRET_KEY`:

```bash
stellar keys generate my-relayer --network testnet --fund
stellar keys secret my-relayer
```

Leave room in it: an invocation against contracts that have gone cold pays to restore them from
archive. Measured cold runs have cost 1.2 to 2.5 XLM. Warm is far cheaper, and varies with how
much the instruction touches: 0.0089846 XLM for a Deposit through a vault, 0.0017 for a claim.

**Two tools.** Step 2 signs a transaction on the source chain, so you need a wallet library. The
examples below use [viem](https://viem.sh). Step 4 reads balances with the
[Stellar CLI](https://developers.stellar.org/docs/tools/developer-tools/cli), a separate install.

## Deployed addresses

Testnet. The code below refers to these by name.

| What | Chain | Address |
|---|---|---|
| `USDC` | Arc Testnet | `0x3600000000000000000000000000000000000000` |
| `TOKEN_MESSENGER` | Arc Testnet | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` |
| Forwarder | Stellar Testnet | `CA66Q2WFBND6V4UEB7RD4SAXSVIWMD6RA4X3U32ELVFGXV5PJK4T4VSZ` |
| Skyhook core | Stellar Testnet | `CCOMST7FEDLYJ5MXZTVKVKMK43AQP2U2AZEZRHE3XHYO6UF6LKC2654F` |
| Reference SEP-56 vault | Stellar Testnet | `CAY6UNOOWATJW2LXFGMTO6NKLJRVWRKMNVZVPGLKRBLE5Y6OFMDF7IB4` |

Arc publishes a `TokenMessengerWithFees` as well. Use the `TokenMessengerV2` address above.
Circle's [Arc reference](https://docs.arc.io/arc/references/contract-addresses.md) is the source
for both Arc addresses.

The block explorer will not give you the ABI: that address is a proxy, so its verified ABI has no
`depositForBurnWithHook` in it. Here is the fragment you need.

```js
const tokenMessengerAbi = [{
  name: "depositForBurnWithHook",
  type: "function",
  stateMutability: "nonpayable",
  inputs: [
    { name: "amount",               type: "uint256" },
    { name: "destinationDomain",    type: "uint32"  },
    { name: "mintRecipient",        type: "bytes32" },
    { name: "burnToken",            type: "address" },
    { name: "destinationCaller",    type: "bytes32" },
    { name: "maxFee",               type: "uint256" },
    { name: "minFinalityThreshold", type: "uint32"  },
    { name: "hookData",             type: "bytes"   },
  ],
  outputs: [],
}];
```

## The shortest path

A transfer that deposits into a SEP-56 vault on arrival.

### 1. Build the instruction

```js
import { buildInstruction, depositParams, buildHookData, toHex } from "@skyhook-cctp/sdk";

const SKYHOOK_CORE = "CCOMST7FEDLYJ5MXZTVKVKMK43AQP2U2AZEZRHE3XHYO6UF6LKC2654F";
const VAULT        = "CAY6UNOOWATJW2LXFGMTO6NKLJRVWRKMNVZVPGLKRBLE5Y6OFMDF7IB4";
const RECIPIENT    = "GAQB…";  // who ends up holding the vault shares

// handler_id 1 = Deposit; its params are the vault address.
const instruction = buildInstruction(RECIPIENT, 1, depositParams(VAULT));

// Wrap it in Circle's hook frame, addressed to the Skyhook core.
const hookData = toHex(buildHookData(SKYHOOK_CORE, instruction));
```

`buildInstruction` and `depositParams` reject anything that isn't a 56-byte strkey. Circle's
forwarder rejects a wrong `L`, and a broken envelope is the one failure where funds can't be
recovered.

To hold for a recipient instead of depositing, use handler `2` with no params:

```js
const instruction = buildInstruction(RECIPIENT, 2);
```

### 2. Burn on the source chain

Two parameters decide whether the transfer arrives or is lost for good. Circle warns that a wrong
`destinationCaller`, or a `mintRecipient` that isn't the forwarder contract, leaves funds
**permanently stuck**. `buildBurnParameters` builds the call and refuses both before anything is
signed:

```js
import { buildBurnParameters } from "@skyhook-cctp/sdk";

const burn = buildBurnParameters({
  amount: 1_000_000n,   // 6 decimals, as USDC is on the source chain
  forwarder: "CA66Q2WFBND6V4UEB7RD4SAXSVIWMD6RA4X3U32ELVFGXV5PJK4T4VSZ",
  forwardRecipient: SKYHOOK_CORE,   // where the instruction is executed
  burnToken: USDC,                  // from Deployed addresses
  instruction,                      // from step 1
});

// CCTP pulls the USDC with transferFrom, so approve the TokenMessenger first.
// Without this the burn reverts with "ERC20: transfer amount exceeds allowance".
await walletClient.writeContract({
  address: USDC,
  abi: [{ name: "approve", type: "function", stateMutability: "nonpayable",
          inputs: [{ type: "address" }, { type: "uint256" }],
          outputs: [{ type: "bool" }] }],
  functionName: "approve",
  args: [TOKEN_MESSENGER, 1_000_000n],
});

await walletClient.writeContract({
  address: TOKEN_MESSENGER,         // from Deployed addresses
  abi: tokenMessengerAbi,
  functionName: "depositForBurnWithHook",
  args: burn.args,                  // already in the ABI's order
});
```

`mintRecipient` and `destinationCaller` default to `forwarder`, the only correct value, so you
don't pass them. You still *can*, so a wrong value gets a clear error:

```
mintRecipient is Skyhook's own address. It belongs in forwardRecipient, inside the hook
data. The mint always goes to CctpForwarder (CA66Q2WF…), which then forwards.
```

That's the easy mistake: naming Skyhook because it's the contract that acts on the funds.
Skyhook's address goes in `forwardRecipient` inside the hook data. The mint always goes to the
forwarder.

Why check this up front? Once the burn is signed its nonce is spent, and a message that can't be
delivered can't be retried or refunded. Before signing is the only chance.

Want to build the call yourself? `burn` also has each parameter by name (`amount`,
`destinationDomain`, `mintRecipient`, `burnToken`, `destinationCaller`, `maxFee`,
`minFinalityThreshold`, `hookData`), with addresses already `bytes32`-encoded.

### Steps 1 and 2 as one file

The snippets above leave the viem setup to you, because every app already has its own. If you
just want something that runs, this is both steps in one file. Save it as `burn.mjs`:

```js
import { buildInstruction, depositParams, buildBurnParameters } from "@skyhook-cctp/sdk";
import { createWalletClient, createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";

const USDC            = "0x3600000000000000000000000000000000000000";
const TOKEN_MESSENGER = "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA";
const FORWARDER       = "CA66Q2WFBND6V4UEB7RD4SAXSVIWMD6RA4X3U32ELVFGXV5PJK4T4VSZ";
const SKYHOOK_CORE    = "CCOMST7FEDLYJ5MXZTVKVKMK43AQP2U2AZEZRHE3XHYO6UF6LKC2654F";
const VAULT           = "CAY6UNOOWATJW2LXFGMTO6NKLJRVWRKMNVZVPGLKRBLE5Y6OFMDF7IB4";

const amount = 1_000_000n;   // 1 USDC, 6 decimals on the source chain

const tokenMessengerAbi = [{
  name: "depositForBurnWithHook",
  type: "function",
  stateMutability: "nonpayable",
  inputs: [
    { name: "amount",               type: "uint256" },
    { name: "destinationDomain",    type: "uint32"  },
    { name: "mintRecipient",        type: "bytes32" },
    { name: "burnToken",            type: "address" },
    { name: "destinationCaller",    type: "bytes32" },
    { name: "maxFee",               type: "uint256" },
    { name: "minFinalityThreshold", type: "uint32"  },
    { name: "hookData",             type: "bytes"   },
  ],
  outputs: [],
}];

const approveAbi = [{
  name: "approve",
  type: "function",
  stateMutability: "nonpayable",
  inputs: [{ type: "address" }, { type: "uint256" }],
  outputs: [{ type: "bool" }],
}];

// The viem setup: an account from your key, and a chain to send on.
const account = privateKeyToAccount(process.env.SOURCE_PRIVATE_KEY);
const wallet  = createWalletClient({ account, chain: arcTestnet, transport: http() });
const client  = createPublicClient({ chain: arcTestnet, transport: http() });

// 1. The instruction: deposit into the vault for this recipient.
const instruction = buildInstruction(process.env.RECIPIENT, 1, depositParams(VAULT));

// 2. The burn parameters, checked before anything is signed.
const burn = buildBurnParameters({
  amount,
  forwarder: FORWARDER,
  forwardRecipient: SKYHOOK_CORE,
  burnToken: USDC,
  instruction,
});

// CCTP pulls the USDC with transferFrom, so approve first.
const approveHash = await wallet.writeContract({
  address: USDC, abi: approveAbi, functionName: "approve",
  args: [TOKEN_MESSENGER, amount],
});
await client.waitForTransactionReceipt({ hash: approveHash });

const burnHash = await wallet.writeContract({
  address: TOKEN_MESSENGER, abi: tokenMessengerAbi,
  functionName: "depositForBurnWithHook",
  args: burn.args,
});
await client.waitForTransactionReceipt({ hash: burnHash });

console.log("burned:", burnHash);
console.log("now relay it:  npx @skyhook-cctp/relayer", burnHash);
```

It reads two values from the same `.env` the relayer uses, so add them there:

```bash
RECIPIENT=G...              # who ends up holding the vault shares
SOURCE_PRIVATE_KEY=0x...    # the Arc key holding the USDC
```

Then run it. `--env-file` needs Node 22 or newer:

```bash
npm install @skyhook-cctp/sdk viem
node --env-file=.env burn.mjs
```

It prints the burn hash and the exact relayer command for step 3.

### 3. Relay it

The instruction doesn't run until someone submits it, because the forwarder only credits. Run
the [relayer](../relayer/README.md) on the burn:

```bash
npx @skyhook-cctp/relayer <burnTxHash>
```

From a clone of the repository instead, `node packages/relayer/src/cli.js <burnTxHash>`.

It waits for Circle's attestation, then calls `Skyhook.execute`. Anyone can run a relayer and it
never holds funds, so you can run your own or use someone else's.

The recipient ends up with vault shares. **No USDC trustline is needed**, because shares live in
the vault's storage. So Deposit can reach recipients a plain USDC payout can't.

### 4. Confirm it landed

The relayer prints a transaction hash, but the real check is the recipient's balance in the vault:

```bash
stellar contract invoke --id <vault> --source <any-funded-account> \
  --network testnet --send=no -- balance --account <recipient>
```

It should go up by the delivered amount at 7 decimals, so 1 USDC burned shows up as `10000000`.
Vault shares are a Soroban token, not a classic asset, so a wallet won't list them until you add
the vault's contract id as a custom token. The balance is there either way.

If the instruction fell back to Hold, the amount is waiting under the recipient's name:

```bash
stellar contract invoke --id <handler-hold> --source <any-funded-account> \
  --network testnet --send=no -- held --recipient <recipient>
```

Both calls are read-only (`--send=no`), free, and anyone can run them. You don't need the
recipient's key.

Run them next to the relayer's `.env` and the Stellar CLI reads `STELLAR_RPC_URL` from it, then
asks for a network passphrase. Simplest fix is to put it in the same `.env`:

```bash
STELLAR_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
```

The relayer ignores it, so nothing else changes. Otherwise pass `--network-passphrase "Test SDF
Network ; September 2015"` on each call, or run them from another directory.

## Reading a message back

Circle's API returns **every address field as `null`** for Stellar messages, because it can't
tell an account from a contract. The values are still in the raw message:

```js
import { parseCctpMessage, isFinalized } from "@skyhook-cctp/sdk";

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
| `depositParams(vault)` | Deposit's `params`: the vault address |
| `buildBurnParameters({ … })` | The `depositForBurnWithHook` call, refusing unrecoverable addresses |
| `buildHookData(forwardRecipient, payload?)` | Circle's hook frame around an instruction |
| `parseCctpMessage(hex)` | A raw CCTP message, all fields |
| `parseHookData(bytes)` | Just the hook frame |
| `isFinalized(parsed)` | Whether the attestation reached finality |
| `toHex(bytes)` | `0x`-prefixed hex |

## What happens when something goes wrong

Your instruction doesn't have to be perfect for the funds to be safe, but it decides how easy
they are to recover.

| If | Then |
|---|---|
| The vault address isn't a vault, or is for another asset | The handler refuses before collecting; funds go to Hold, claimable by `fallback_recipient` |
| `handler_id` isn't registered | Straight to Hold |
| `params_len` doesn't match the bytes | Straight to Hold |
| The envelope is under 57 bytes, or `fallback_recipient` isn't a valid strkey | **The funds can't be recovered.** No recipient can be read, so they're recorded by CCTP nonce, and nobody can prove a nonce is theirs |

That last row is why this library validates strkeys. Build the envelope with `buildInstruction`
and it can't happen.

## Networks

Testnet only for now. The addresses above are on Stellar Testnet, with Arc Testnet (CCTP domain
26) as the source chain.

## Development

```bash
npm install          # from the repo root; workspaces wire the packages together
npm test --workspace @skyhook-cctp/sdk
```

Tests use real messages captured from Testnet, so the parser is checked against real data, not a
fixture written to match it.

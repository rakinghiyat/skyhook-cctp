<div align="center">
  <img src=".github/banner.png" alt="Skyhook: CCTP hooks on Stellar" width="100%">
  <p>The execution layer for <a href="https://developers.circle.com/cctp">CCTP</a> hooks on <a href="https://stellar.org">Stellar</a>, so USDC does something the moment it lands.</p>
  <a href="https://www.npmjs.com/package/@skyhook-cctp/sdk"><img src="https://img.shields.io/npm/v/@skyhook-cctp/sdk.svg?color=296FFF" alt="npm"></a>
  <img src="https://img.shields.io/badge/Circle-CCTP%20v2-16C65C.svg" alt="Circle CCTP v2">
  <img src="https://img.shields.io/badge/Soroban-Rust-858585.svg" alt="Soroban / Rust">
  <img src="https://img.shields.io/badge/network-Stellar%20Testnet-7093B5.svg" alt="Stellar Testnet">
</div>

---

## What this is

Circle's CCTP brings native USDC to Stellar, but it doesn't run hooks. Inside
`mint_and_forward`, `CctpForwarder` **transfers** the minted USDC to the recipient and never
calls it. Soroban tokens have no receive callback, so a contract recipient just gets credited.

Circle's hook format still reserves a trailing field for an integrator payload. No contract on
Stellar reads it today.

Skyhook reads that field and runs the instruction inside it. Arriving USDC can go straight into
a SEP-56 vault, or wait safely on-chain if the recipient can't receive it yet, instead of the
transfer reverting.

## Where to go next

| If you want to | Read |
|---|---|
| Send USDC that does something on arrival | [Integration guide](packages/sdk/README.md) |
| Write a new handler | [Handler authoring](contracts/skyhook-core/README.md) |
| Run a relayer | [Relayer](packages/relayer/README.md) |
| Understand the format itself | [Instruction format](#instruction-format) below |

## How it works

Since the forwarder doesn't call anyone, Skyhook **calls the forwarder** itself.
`CctpForwarder` is public, so this works.

```
relayer
  └─> Skyhook.execute(message, attestation)
        ├─> CctpForwarder.mint_and_forward(message, attestation)
        │     forwardRecipient = Skyhook's own address
        │     └─> USDC minted, transferred into Skyhook's balance
        ├─> read the instruction at offset 32+L
        ├─> resolve handler_id through the registry
        └─> invoke the handler (caught)
```

Mint, delivery and execution all happen in **one Soroban invocation**.

### When a handler fails

`mint_and_forward` is atomic, so a handler failure must not bubble up, or the mint reverts too.
Handlers are called through a caught call, which gives four levels:

| Level | Condition | Result |
|---|---|---|
| 1 | The named handler succeeds | Instruction executed |
| 2 | The handler fails, or the instruction is unrecognized | Funds go to the Hold handler |
| 3 | Hold also fails, or no recipient could be read | Funds stay in Skyhook, recorded as unresolved |
| 4 | n/a | Level 3 can't fail: no transfer, no external call, one storage write |

**Minted funds are never lost and never revert the transfer.** At worst they wait in the
contract until claimed with `claim_unresolved(recipient, to)`.

One case has no way out, on purpose. If an instruction is too broken to read a recipient, the
funds are recorded against the CCTP nonce, and nobody can prove a nonce is theirs. Letting
someone withdraw would need an admin to decide who, and Skyhook has no admin. Building the
instruction with the payload builder avoids this.

### Handlers collect their own funds

Before calling a handler, the core authorizes exactly one token transfer (this `from`, this
`to`, this `amount`), and the handler makes that transfer inside its own call. If the handler
panics, the transfer rolls back with it. Paying the handler first wouldn't roll back, and the
funds would be stuck with a handler that refused them.

## Instruction format

The instruction lives in the trailing integrator payload of Circle's hook data.

### Circle's hook frame

| Bytes | Contents |
|---|---|
| `0–23` | Magic. Not validated; all zeroes and Circle's `cctp-forward` marker both parse |
| `24–27` | Version, `uint32`. Must be `0` |
| `28–31` | `L`, `uint32`: byte length of `forwardRecipient` |
| `32 .. 32+L-1` | `forwardRecipient` as a Stellar strkey |
| `32+L ..` | Integrator payload: the Skyhook instruction |

For Skyhook, `forwardRecipient` is **always the Skyhook core address**. That's what puts the
minted USDC where it can be acted on.

Three forwarder rules that are easy to get wrong:

- **`L` must match the strkey exactly.** The forwarder reads exactly `32..32+L`. Too small cuts
  the strkey, zero makes it empty, and both fail. Use the real length: 56 for `C…`/`G…`, 69 for
  `M…`.
- **A `C…` contract strkey is valid**, just like `G…` and `M…`.
- **`forwardRecipient` can't be the token contract or the forwarder itself.**

Bytes after `32+L` are allowed, and the Skyhook instruction depends on that.

### The Skyhook instruction

All integers are big-endian, like the surrounding frame. Offsets are relative to `32+L`.

| Offset | Size | Field | Notes |
|---|---|---|---|
| `0` | 1 | `version` | `0x01` |
| `1` | 56 | `fallback_recipient` | Stellar strkey. Fixed position, so it can be read even if the rest is corrupt |
| `57` | 4 | `handler_id` | Registry key naming the handler |
| `61` | 2 | `params_len` | Byte length of `params` |
| `63` | var | `params` | Handler-defined |

The raw CCTP message has no usable Stellar recipient: `forwardRecipient` is always Skyhook and
`mintRecipient` is always `CctpForwarder`. That's why `fallback_recipient` exists, and why it
comes early enough to survive a broken tail.

**Parsing rules**

- `version` and `fallback_recipient` (`0..57`) are read on their own. If the envelope is shorter
  than 57 bytes, or those 56 bytes aren't a valid strkey, the funds are recorded by nonce and
  can't be recovered. This is the worst case.
- Otherwise, an unknown `version`, an envelope under 63 bytes, an unregistered `handler_id`, or
  a `params_len` that doesn't match the remaining bytes all go to Hold for `fallback_recipient`.
- Bytes after `63 + params_len` are ignored, leaving room for future extensions.

### Handler parameters

**`handler_id = 1`: Deposit.** `params` is the vault address as a 56-byte strkey, so
`params_len` = 56. The handler checks that the vault's asset is the token being delivered
before collecting anything, and refuses otherwise.

**`handler_id = 2`: Hold.** `params` is empty, `params_len` = 0. Also where funds go when
another instruction fails.

## Deployed on Stellar Testnet

| Contract | Address |
|---|---|
| `skyhook-core` | [`CCOMST7FEDLYJ5MXZTVKVKMK43AQP2U2AZEZRHE3XHYO6UF6LKC2654F`](https://stellar.expert/explorer/testnet/contract/CCOMST7FEDLYJ5MXZTVKVKMK43AQP2U2AZEZRHE3XHYO6UF6LKC2654F) |
| `handler-deposit` (id 1) | [`CBZOKXZKKORG4FI5URPJMX3XHBDU6E7EXPD4YY36R36PHVOMEKWXRVFY`](https://stellar.expert/explorer/testnet/contract/CBZOKXZKKORG4FI5URPJMX3XHBDU6E7EXPD4YY36R36PHVOMEKWXRVFY) |
| `handler-hold` (id 2) | [`CCLVTDVGYHSWFC7AW2L327WMFZVKZDFYY24G7Z4IZO2SQDM4DVWE7TC6`](https://stellar.expert/explorer/testnet/contract/CCLVTDVGYHSWFC7AW2L327WMFZVKZDFYY24G7Z4IZO2SQDM4DVWE7TC6) |
| Reference SEP-56 vault | [`CAY6UNOOWATJW2LXFGMTO6NKLJRVWRKMNVZVPGLKRBLE5Y6OFMDF7IB4`](https://stellar.expert/explorer/testnet/contract/CAY6UNOOWATJW2LXFGMTO6NKLJRVWRKMNVZVPGLKRBLE5Y6OFMDF7IB4) |

The vault is our own deployment of OpenZeppelin's audited Fungible Token Vault. The Deposit
handler works with **any SEP-56 vault**, not just this one, because the vault address comes in
the instruction.

## Authorization

The handler registry is **open and append-only**. Anyone can register a handler, and the
instruction names which one to use, so the sender decides, not an operator. An id can't be
rebound once taken, which makes it safe to publish.

Skyhook has no admin key, no whitelist and no upgrade path. Two values are set at deploy and
never change: the `CctpForwarder` address and the USDC token contract.

**One caveat.** Circle's `CctpForwarder` can itself be upgraded and paused by Circle, and Skyhook
pins its address. If the forwarder is paused, `mint_and_forward` fails before anything is
minted, so nothing is lost. In short: **Skyhook adds no privileged party, and trusts only what
CCTP already requires you to trust.**

## Repository

```
contracts/
  skyhook-core/      the core: forwarder call, parser, registry, fallback ladder
  handler-deposit/   deposits into a SEP-56 vault
  handler-hold/      holds for a recipient who cannot yet receive; claim, claim_to
  reference-vault/   a self-deployed OpenZeppelin vault, for testing and the demo
packages/
  sdk/               payload builder and message parser
  relayer/           polls Circle, submits execution
```

```bash
cargo test --workspace     # contracts
npm install && npm test --workspaces
stellar contract build
```

## Status

**Stellar Testnet only, and not audited.** These contracts hold funds and haven't had a
third-party security review. A review is planned before any mainnet deployment, so don't deploy
this to mainnet as it is.

`claim()` inside a fee bump, so the recipient signs without spending XLM, runs end to end at
[skyhookcctp.com/claim](https://www.skyhookcctp.com/claim). The recipient signs in
[Varial](https://varialwallet.com/) (formerly Freighter) and a Testnet sponsor pays the fee.

## License

[Apache-2.0](LICENSE)

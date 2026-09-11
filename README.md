<div align="center">
  <h1>Skyhook</h1>
  <p>The execution layer for <a href="https://developers.circle.com/cctp">CCTP</a> hooks on <a href="https://stellar.org">Stellar</a> - so USDC does something the moment it lands.</p>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache-E38B40.svg" alt="License"></a>
  <img src="https://img.shields.io/badge/Soroban-Rust-858585.svg" alt="Soroban / Rust">
  <img src="https://img.shields.io/badge/SDK-TypeScript-3178c6.svg" alt="TypeScript">
  <img src="https://img.shields.io/badge/network-Stellar%20Testnet-7093B5.svg" alt="Stellar Testnet">
  <img src="https://img.shields.io/badge/status-in%20development-f59e0b.svg" alt="Status">
</div>

---

## What this is

Circle's CCTP moves native USDC to Stellar, but it does not execute hooks — by design. Inside
`mint_and_forward`, `CctpForwarder` **transfers** the minted USDC to the recipient; it never
invokes it. Soroban has no receive callback in its token interface, so a contract named as the
recipient is credited and never called.

Circle's hook format nevertheless reserves a trailing field for an integrator-defined payload.
No contract on Stellar reads it today.

Skyhook reads that field and executes the instruction inside it. Arriving USDC can deposit
itself into a SEP-56 vault on arrival, or rest safely on-chain when the recipient is not yet
able to receive — instead of the whole transfer reverting.

## Where to go next

| If you want to | Read |
|---|---|
| Send USDC that does something on arrival | [Integration guide](packages/sdk/README.md) |
| Write a new handler | [Handler authoring](contracts/skyhook-core/README.md) |
| Run a relayer | [Relayer](packages/relayer/README.md) |
| Understand the format itself | [Instruction format](#instruction-format) below |

## How it works

Because the forwarder credits rather than invokes, Skyhook **calls the forwarder** rather than
waiting to be called by it. `CctpForwarder` is publicly callable, so this composes.

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

Mint, delivery and execution complete inside **one Soroban invocation**.

### When a handler fails

`mint_and_forward` is atomic, so a failing handler must never propagate upward or the mint
itself would revert. Handlers are invoked through a caught call, giving four levels:

| Level | Condition | Result |
|---|---|---|
| 1 | The named handler succeeds | Instruction executed |
| 2 | The handler fails, or the instruction is unrecognized | Funds route to the Hold handler |
| 3 | Hold also fails, or no recipient could be recovered | Funds stay in Skyhook, recorded as unresolved |
| 4 | — | Level 3 cannot fail: no transfer, no external call, one storage write |

**Minted funds are never lost and never cause the transfer to revert.** In the worst case they
sit in the contract until claimed, which `claim_unresolved(recipient, to)` exists for.

One case has no way out, deliberately: when an instruction is too malformed to yield a recipient
at all, the funds are keyed by CCTP nonce, and nobody can prove a nonce belongs to them.
Allowing a withdrawal would mean appointing someone to decide who is entitled — the admin key
this design refuses to have. Building the envelope with the payload builder avoids the situation
entirely.

### Handlers collect their own funds

Before invoking a handler, the core authorizes exactly one token transfer — this `from`, this
`to`, this `amount` — and the handler makes that transfer inside its own invocation. A panic
therefore rolls the transfer back with everything else. Paying a handler up front would not be
undone by its rollback, and the funds would sit at a handler that rejected them.

## Instruction format

The instruction lives in the trailing integrator payload of Circle's hook data.

### Circle's hook frame

| Bytes | Contents |
|---|---|
| `0–23` | Magic — not validated; all-zero and Circle's own `cctp-forward` marker both parse |
| `24–27` | Version, `uint32` — must be `0` |
| `28–31` | `L`, `uint32` — byte length of `forwardRecipient` |
| `32 .. 32+L-1` | `forwardRecipient` as a Stellar strkey |
| `32+L ..` | Integrator-defined payload — the Skyhook instruction |

For Skyhook, `forwardRecipient` is **always the Skyhook core address**; that is what makes the
minted USDC land where it can be acted on.

Three rules Circle's forwarder enforces that are easy to get wrong:

- **`L` must describe the strkey exactly.** The forwarder slices `32..32+L` and parses precisely
  those bytes. Too small truncates the strkey, zero yields an empty one, and both fail. Write
  the real byte length — 56 for `C…`/`G…`, 69 for `M…`.
- **A `C…` contract strkey is valid**, on equal footing with `G…` and `M…`.
- **`forwardRecipient` may not be the token contract or the forwarder itself.**

Trailing bytes beyond `32+L` are explicitly tolerated — which is what the entire Skyhook
instruction depends on.

### The Skyhook instruction

All integers big-endian, matching the enclosing frame. Offsets are relative to `32+L`.

| Offset | Size | Field | Notes |
|---|---|---|---|
| `0` | 1 | `version` | `0x01` |
| `1` | 56 | `fallback_recipient` | Stellar strkey. Fixed position, so it stays readable even if everything after it is corrupt |
| `57` | 4 | `handler_id` | Registry key naming the handler |
| `61` | 2 | `params_len` | Byte length of `params` |
| `63` | var | `params` | Handler-defined |

There is no usable Stellar-format recipient anywhere in the raw CCTP message —
`forwardRecipient` is always Skyhook itself and `mintRecipient` is always `CctpForwarder`. That
is why `fallback_recipient` exists, and why it sits early enough to survive a malformed tail.

**Parsing rules**

- `version` and `fallback_recipient` (`0..57`) parse independently of everything after. An
  envelope shorter than 57 bytes, or 56 bytes that are not a valid strkey, is the most severe
  case — the funds end up keyed by nonce and are unrecoverable.
- Otherwise: an unrecognized `version`, an envelope shorter than 63 bytes, a `handler_id` not in
  the registry, or a `params_len` inconsistent with the remaining bytes all route to Hold using
  the recovered `fallback_recipient`.
- Trailing bytes beyond `63 + params_len` are ignored, leaving room for future extensions.

### Handler parameters

**`handler_id = 1` — Deposit.** `params` is the vault address as a 56-byte strkey;
`params_len` = 56. The handler confirms the vault's underlying asset is the token being
delivered before collecting anything, and refuses otherwise.

**`handler_id = 2` — Hold.** `params` is empty; `params_len` = 0. Also the fallback target
whenever another instruction fails.

## Deployed on Stellar Testnet

| Contract | Address |
|---|---|
| `skyhook-core` | [`CCOMST7FEDLYJ5MXZTVKVKMK43AQP2U2AZEZRHE3XHYO6UF6LKC2654F`](https://stellar.expert/explorer/testnet/contract/CCOMST7FEDLYJ5MXZTVKVKMK43AQP2U2AZEZRHE3XHYO6UF6LKC2654F) |
| `handler-deposit` (id 1) | [`CBZOKXZKKORG4FI5URPJMX3XHBDU6E7EXPD4YY36R36PHVOMEKWXRVFY`](https://stellar.expert/explorer/testnet/contract/CBZOKXZKKORG4FI5URPJMX3XHBDU6E7EXPD4YY36R36PHVOMEKWXRVFY) |
| `handler-hold` (id 2) | [`CCLVTDVGYHSWFC7AW2L327WMFZVKZDFYY24G7Z4IZO2SQDM4DVWE7TC6`](https://stellar.expert/explorer/testnet/contract/CCLVTDVGYHSWFC7AW2L327WMFZVKZDFYY24G7Z4IZO2SQDM4DVWE7TC6) |
| Reference SEP-56 vault | [`CAY6UNOOWATJW2LXFGMTO6NKLJRVWRKMNVZVPGLKRBLE5Y6OFMDF7IB4`](https://stellar.expert/explorer/testnet/contract/CAY6UNOOWATJW2LXFGMTO6NKLJRVWRKMNVZVPGLKRBLE5Y6OFMDF7IB4) |

The vault is a self-deployed instance of OpenZeppelin's audited Fungible Token Vault. The
Deposit handler targets the **SEP-56 interface**, not this vault — any conforming vault works,
because its address travels in the instruction.

## Authorization

The handler registry is **permissionless and append-only**. Anyone may register a handler, and
the instruction names which handler to use, so the sender chooses rather than an operator. An id
once bound cannot be rebound, which is what makes an id safe to publish.

Skyhook has no admin key, no whitelist, and no upgrade path. Two values are fixed at
initialization and immutable after: the trusted `CctpForwarder` address and the USDC token
contract.

**That claim needs one qualification, and dropping it would overstate the guarantee.** Circle's
`CctpForwarder` is itself upgradeable and pausable by Circle, and Skyhook pins its address. If
the forwarder is paused, `mint_and_forward` fails before any mint happens, so nothing is lost and
nothing needs recovering. The honest statement is that **Skyhook adds no privileged party, and
inherits exactly the trust the CCTP deployment already requires.**

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

Testnet only. This is an Instawards-funded engagement and has **not been audited**; a security
audit is planned before any mainnet deployment.

`claim()` inside a fee-bumped envelope — letting a recipient sign without spending XLM — is
implemented at the contract level but not yet demonstrated end to end. The Freighter claim page
is where that gets built.

## License

[Apache-2.0](LICENSE)

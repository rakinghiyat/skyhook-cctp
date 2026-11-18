# skyhook-core

Calls Circle's `CctpForwarder`, reads the Skyhook instruction from the message, finds the named
handler, and runs the fallback ladder that keeps minted funds from being lost.

See the root [README](../../README.md) for how it all fits together and the instruction format.

## Writing a handler

A handler is a separate Soroban contract that Skyhook calls when an instruction names it. Anyone
can write one, and this is the interface.

### The entry point

```rust
execute(recipient: Address, amount: i128, params: Bytes)
```

| Argument | Meaning |
|---|---|
| `recipient` | The envelope's `fallback_recipient`, never anything from `params`. The core decides who the funds are for, so a handler can't redirect them through its own parameters |
| `amount` | USDC for this execution, at Stellar's 7 decimals. It's the core's balance change across the mint, so it's what actually arrived, after decimal scaling and any fee |
| `params` | Opaque to the core. Decode it however you like |

`params` is plain bytes, not typed arguments, so the core can call handlers it has never seen.
Deposit reads a vault address from it, Hold ignores it, and yours reads whatever it needs.

### Taking the funds

**The handler pulls; the core doesn't push.** Before calling you, the core uses
`authorize_as_current_contract` to allow exactly one token transfer: this `from`, this `to`, this
`amount`. You make that transfer yourself, inside your own call.

You need the core's and the token's addresses for that. Take both **in the constructor**, not as
call arguments, since you're written for one specific core.

```rust
pub fn __constructor(env: Env, core: Address, token: Address) { /* store both, immutably */ }
```

Why not just receive the funds first? A panic only rolls back your own frame, not the caller's.
Funds moved by the core would stay with you after you rejected them. Pulling inside your own call
means a panic undoes the transfer too.

It also means you don't need a "only the core can call this" check. The pull is
`transfer(core, self, amount)` from your own core, so it only works when that core authorized
it. Anyone else gets a failed transfer and a reverted call.

### What you can assume

- You're called through a caught call. **Panicking is how you refuse**: the core catches it and
  sends the funds to Hold.
- You're authorized to pull exactly `amount`, once.
- You're called at most once per CCTP nonce.

### What you must guarantee

**Validate before you collect.** Check everything you can (that `params` decodes, that the
address is the kind of contract you expect, that it uses the token you were given) *before*
pulling the funds. Then pull, then act.

This matters because the whole ladder runs in one invocation with a limited budget, and work
done before a failure still counts against it. Both cases were measured on Testnet:

| Where the handler failed | Outcome |
|---|---|
| Right away, before moving anything | Falls through to Hold and lands |
| After collecting the funds and calling the wrong contract | Ran out of budget; the whole transaction failed |

The routing is the same in both; only the budget differs. Checking early is also just safer, since
you never hand assets to a destination you didn't check. The Deposit handler calls `query_asset`
on the vault and refuses unless the asset matches, which catches both a non-vault and a vault for
the wrong token.

Also:

- **Use the full amount or panic.** Never use part of it and return normally.
- **Don't keep authority beyond this call.** Never store the caller's authorization. Pulling more
  than `amount` just fails, because the authorization covers one exact transfer, and the core
  treats that as a refusal.
- **Stay deterministic.** Don't depend on the ledger timestamp or sequence number.

### Registering

```rust
register_handler(id: u32, contract: Address)
```

Open to anyone: no whitelist, no admin. **Append-only**: once an id is taken it can't be
rebound, which makes it safe for senders to use.

The cost: shipping a fixed handler means deploying a new core with a new registry and binding
new handlers to it. Nobody can repoint an id, not even you, so handler upgrades are always
visible.

## Contract interface

| Function | Purpose |
|---|---|
| `execute(message, attestation)` | The whole flow: mint through the forwarder, parse, route |
| `register_handler(id, contract)` | Bind a handler id, permanently |
| `unresolved_by_recipient(recipient)` | Funds left at Level 3, by recipient |
| `unresolved_by_nonce(nonce)` | Funds left at Level 3 with no recipient |
| `claim_unresolved(recipient, to)` | The way out of Level 3. Needs the recipient's signature |

## Layout

```
src/
  lib.rs       execute, the fallback ladder, the registry entry point
  parse.rs     CCTP message and instruction parsing; never panics
  registry.rs  handler_id -> address, append-only
  storage.rs   persistent-storage keys
```

```bash
cargo test --workspace
stellar contract build
```

Tests cover every level of the ladder. One test pins that funds recorded by nonce can't be
recovered, so changing that has to be a deliberate decision.

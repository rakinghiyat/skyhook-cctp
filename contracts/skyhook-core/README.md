# skyhook-core

Calls Circle's `CctpForwarder`, reads the Skyhook instruction out of the resulting message,
resolves the named handler, and applies the fallback ladder that keeps minted funds from ever
being lost.

See the root [README](../../README.md) for how the whole thing fits together and what the
instruction format looks like on the wire.

## Writing a handler

A handler is a separate Soroban contract that Skyhook invokes when an instruction names it.
"Anyone can add a handler" is only a real claim if the interface is written down, so here it is.

### The entry point

```rust
execute(recipient: Address, amount: i128, params: Bytes)
```

| Argument | Meaning |
|---|---|
| `recipient` | The envelope's `fallback_recipient`, never anything out of `params`. The core decides who the funds are for, so a handler cannot redirect them by lying in its own parameters |
| `amount` | USDC credited for this execution, at Stellar's 7 decimals. Measured as the core's balance delta across the mint, so it reflects what actually arrived — after decimal scaling and after any fee taken in transit |
| `params` | Opaque to the core. Decode it however your handler likes |

`params` is a byte string rather than typed arguments. That is what lets the core invoke a
handler it has never heard of: Deposit reads a vault address out of it, Hold ignores it, and
yours reads whatever it needs.

### Taking the funds

**The handler pulls; the core does not push.** Before invoking you, the core calls
`authorize_as_current_contract` authorizing exactly one token transfer — this `from`, this `to`,
this `amount`, nothing else. You make that transfer yourself, inside your own invocation.

You will need the core's address and the token's address to do it. Take both **at construction**
rather than as call arguments; you are writing against a particular core and know which one.

```rust
pub fn __constructor(env: Env, core: Address, token: Address) { /* store both, immutably */ }
```

Why not just hand you the funds first: a panic rolls back the panicking frame, not the caller's.
Funds moved in the core's frame would survive your rollback and be stranded at a handler that
rejected them. Pulling inside your own frame means the transfer is undone with everything else
you did.

This also means you need no "only the core may call this" check. The pull is
`transfer(core, self, amount)` for the `core` you were built against, so it can only succeed
inside an invocation that particular core authorized. Any other caller gets a failed transfer and
a reverted call.

### What you may assume

- You are invoked through a caught call. **Panicking is the correct way to reject** — the core
  catches it and routes the funds to Hold.
- You have been authorized to pull exactly `amount`, once.
- You are called at most once per CCTP nonce.

### What you must guarantee

**Validate before you collect.** Check everything checkable — that `params` decodes, that the
address it names is the kind of contract you expect, that it operates on the token you were
handed — *before* pulling the funds. Then pull, then act.

This is not style. The whole fallback ladder runs inside one invocation with a finite resource
budget, and work done before failing is charged for even though your own changes roll back. Both
outcomes were measured on Testnet:

| Where the handler failed | Outcome |
|---|---|
| Immediately, before moving anything | Falls through to Hold and lands |
| After collecting the funds and calling a contract that turned out to be wrong | Exceeded the budget; the whole transaction failed |

The routing logic is identical in both cases — only the budget differs. Validating early is also
simply more correct: it is how you avoid handing assets to a destination you never confirmed was
suitable. The Deposit handler calls `query_asset` on the vault and refuses unless the underlying
asset matches, which catches both a non-vault and a vault for the wrong token.

Also:

- **Consume the full amount or panic.** Never partially consume and return normally.
- **Claim no authority beyond this execution.** Never store the caller's authorization for reuse.
  Trying to pull more than `amount` simply fails — the authorization is scoped to one exact
  transfer — and the core treats that like any other rejection.
- **Stay deterministic.** No dependence on ledger timestamp or sequence number.

### Registering

```rust
register_handler(id: u32, contract: Address)
```

Permissionless — anyone may register, there is no whitelist and no admin. **Append-only**: an id
once bound cannot be rebound, which is what makes an id safe for a sender to encode.

That guarantee has a cost worth knowing before you need it. Shipping a corrected handler means a
new core with a fresh registry, and new handlers bound to it — an id cannot be pointed somewhere
else, not even by you. Handler upgrades are deliberate, visible events rather than quiet
substitutions.

## Contract interface

| Function | Purpose |
|---|---|
| `execute(message, attestation)` | The whole flow: mint through the forwarder, parse, route |
| `register_handler(id, contract)` | Bind a handler id, permanently |
| `unresolved_by_recipient(recipient)` | Funds stranded at Level 3, by recipient |
| `unresolved_by_nonce(nonce)` | Funds stranded with no recipient recoverable |
| `claim_unresolved(recipient, to)` | The way out of Level 3 — requires the recipient's signature |

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

Tests cover every rung of the ladder, including that funds keyed by CCTP nonce stay
unrecoverable — pinned deliberately, so changing that trade-off has to be a decision rather than
an accident.

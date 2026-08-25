#![no_std]
#[cfg(test)]
extern crate std;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Bytes, Env, IntoVal, Symbol};

mod parse;
mod registry;

// Core Skyhook contract: calls the CCTP forwarder, parses its own instruction out of the
// resulting message, and keeps a permissionless handler registry (docs/ARCHITECTURE.md §3).
//
// What this deliberately does NOT do yet: actually invoke a resolved handler, or apply the
// fallback ladder (docs/ARCHITECTURE.md §4). `execute()` still only calls the forwarder;
// `parse`/`registry` are complete and tested, ready for that next step to wire in.

const FORWARDER: Symbol = symbol_short!("FWD");

#[contract]
pub struct SkyhookCore;

#[contractimpl]
impl SkyhookCore {
    /// Set once at deploy time. Immutable thereafter — matches ARCHITECTURE.md §3
    /// ("One privileged value: the trusted CctpForwarder address").
    pub fn __constructor(env: Env, forwarder: Address) {
        env.storage().instance().set(&FORWARDER, &forwarder);
    }

    /// Calls CctpForwarder.mint_and_forward cross-contract. For this probe, forwardRecipient
    /// in the hook data attached to the burn must equal this contract's own address — that is
    /// what the gate is testing.
    pub fn execute(env: Env, message: Bytes, attestation: Bytes) {
        let forwarder: Address = env.storage().instance().get(&FORWARDER).unwrap();
        env.invoke_contract::<()>(
            &forwarder,
            &Symbol::new(&env, "mint_and_forward"),
            (message, attestation).into_val(&env),
        );

        // Parsing and resolving a handler is not wired in here yet — actually invoking it
        // and the fallback ladder (ARCHITECTURE.md §4) are the next task.
    }

    /// Permissionless, append-only. Panics if `id` is already bound (ARCHITECTURE.md §3).
    pub fn register_handler(env: Env, id: u32, contract: Address) {
        registry::register_handler(&env, id, contract);
    }
}

mod test;

#![no_std]
use soroban_sdk::{contract, contractimpl, symbol_short, Address, Bytes, Env, IntoVal, Symbol};

// Week 1 gate probe — the minimal seed of the real skyhook-core contract.
//
// Goal: answer SOW's Days 1-2 gate questions (docs/EVIDENCE.md §2, rows 2 and 4):
//   - Can `mint_and_forward` be called from another contract, with `forwardRecipient` set
//     to the caller?
//   - Does the mint actually land in the calling contract's balance?
//
// What this deliberately does NOT do yet: parse the instruction payload, resolve a handler
// registry, or apply the fallback ladder. That's the real skyhook-core build (SOW Days 3-7 /
// Week 2), scoped once the gate result is known. Payload integrity (gate row 3) is checked
// off-chain in packages/sdk instead of here — see docs/EVIDENCE.md for why.

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
    }
}

mod test;

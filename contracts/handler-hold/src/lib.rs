#![no_std]
#[cfg(test)]
extern crate std;

use soroban_sdk::{
    contract, contractevent, contractimpl, symbol_short, token, Address, Bytes, Env, Symbol,
};

mod storage;
use storage::{DataKey, TTL_EXTEND_TO_LEDGERS, TTL_THRESHOLD_LEDGERS};

// The Hold handler (SPEC.md §3, `handler_id = 2`).
//
// Records arriving USDC against a destination address when it cannot yet be delivered, and
// releases it on claim. This is also where the core's fallback ladder lands whenever a named
// handler fails or an instruction cannot be understood (ARCHITECTURE.md §4, Level 2).
//
// Holding needs no classic trustline: this contract is a contract address, and contract
// addresses hold SAC balances in contract storage. The trustline question only arises at
// payout, which is exactly what `claim` runs into — and handles by simply failing, leaving the
// held balance untouched.
//
// There is no fee-bump logic here, and there should not be. This contract's whole obligation
// is `recipient.require_auth()`. Whether that signature arrives inside a fee-bumped envelope
// paid for by a sponsor is decided when the transaction is built, off-chain.

const CORE: Symbol = symbol_short!("CORE");
const TOKEN: Symbol = symbol_short!("TOKEN");

/// Funds accepted from the core and recorded against `recipient`.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Held {
    pub recipient: Address,
    pub amount: i128,
}

/// Funds released. `to` differs from `recipient` when `claim_to` was used.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Claimed {
    pub recipient: Address,
    pub to: Address,
    pub amount: i128,
}

#[contract]
pub struct HandlerHold;

#[contractimpl]
impl HandlerHold {
    /// Both set once at deploy time and immutable thereafter. `core` is the only contract this
    /// handler will ever pull funds from, which is what makes `execute` safe to expose.
    pub fn __constructor(env: Env, core: Address, token: Address) {
        env.storage().instance().set(&CORE, &core);
        env.storage().instance().set(&TOKEN, &token);
    }

    /// Called by the core. Collects the funds it authorized, then records them.
    ///
    /// No "only the core may call this" check is needed: the pull below is
    /// `transfer(core, self, amount)` for the `core` fixed at construction, so it can only
    /// succeed inside an invocation that particular core authorized. Any other caller gets a
    /// failed transfer and the whole call reverts, recording nothing.
    ///
    /// `params` are unused — Hold's are empty by definition (SPEC.md §3).
    pub fn execute(env: Env, recipient: Address, amount: i128, _params: Bytes) {
        let core: Address = env.storage().instance().get(&CORE).unwrap();
        let token: Address = env.storage().instance().get(&TOKEN).unwrap();

        // Collect first. If this fails the invocation reverts, so the ledger never records a
        // balance that was not actually received.
        token::TokenClient::new(&env, &token).transfer(
            &core,
            &env.current_contract_address(),
            &amount,
        );

        let key = DataKey::Held(recipient.clone());
        let current: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        env.storage().persistent().set(&key, &(current + amount));
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD_LEDGERS, TTL_EXTEND_TO_LEDGERS);

        Held { recipient, amount }.publish(&env);
    }

    /// The recipient collects their own funds.
    ///
    /// Written as `claim(recipient)` rather than the docs' shorthand `claim()` because Soroban
    /// has no implicit caller; naming the address explicitly and requiring its authorization is
    /// what makes it safe.
    pub fn claim(env: Env, recipient: Address) {
        let to = recipient.clone();
        pay_out(&env, recipient, to);
    }

    /// Redirect to an address that is already provisioned, for a recipient whose own account
    /// cannot receive yet. Still requires the *recipient's* authorization — only they can
    /// decide where their funds go.
    pub fn claim_to(env: Env, recipient: Address, to: Address) {
        pay_out(&env, recipient, to);
    }

    /// How much is currently held for `recipient`.
    pub fn held(env: Env, recipient: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Held(recipient))
            .unwrap_or(0)
    }
}

fn pay_out(env: &Env, recipient: Address, to: Address) {
    recipient.require_auth();

    let key = DataKey::Held(recipient.clone());
    let amount: i128 = env.storage().persistent().get(&key).unwrap_or(0);
    if amount <= 0 {
        panic!("nothing held for this recipient");
    }

    // Clear before paying out. If the payout fails — a recipient without a USDC trustline is
    // the expected case — the whole invocation reverts and the entry comes back untouched.
    env.storage().persistent().remove(&key);

    let token: Address = env.storage().instance().get(&TOKEN).unwrap();
    token::TokenClient::new(env, &token).transfer(
        &env.current_contract_address(),
        &to,
        &amount,
    );

    Claimed {
        recipient,
        to,
        amount,
    }
    .publish(env);
}

mod test;

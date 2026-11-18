#![no_std]
#[cfg(test)]
extern crate std;

use soroban_sdk::{
    contract, contractevent, contractimpl, symbol_short, token, Address, Bytes, Env, Symbol,
};

mod storage;
use storage::{DataKey, TTL_EXTEND_TO_LEDGERS, TTL_THRESHOLD_LEDGERS};

// The Hold handler (`handler_id = 2`).
//
// Keeps USDC for a recipient who can't receive it yet, and pays it out on claim. The core also
// falls back here when a handler fails or an instruction can't be read.
//
// Holding needs no trustline, because a contract keeps SAC balances in its own storage. The
// trustline only matters at payout: if it's missing, `claim` fails and the balance stays put.
//
// No fee-bump logic belongs here. This contract only checks `recipient.require_auth()`; who
// pays the fee is decided off-chain when the transaction is built.

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
    /// Both are set once and never change. `core` is the only contract this handler pulls
    /// from, which is why `execute` is safe to expose.
    pub fn __constructor(env: Env, core: Address, token: Address) {
        env.storage().instance().set(&CORE, &core);
        env.storage().instance().set(&TOKEN, &token);
    }

    /// Called by the core. Collects the funds it authorized, then records them.
    ///
    /// No caller check is needed. The pull is `transfer(core, self, amount)` from our own
    /// core, so it only works when that core authorized it. Anyone else gets a failed transfer
    /// and the call reverts.
    ///
    /// `params` is unused, since Hold takes none.
    pub fn execute(env: Env, recipient: Address, amount: i128, _params: Bytes) {
        let core: Address = env.storage().instance().get(&CORE).unwrap();
        let token: Address = env.storage().instance().get(&TOKEN).unwrap();

        // Collect first. If it fails everything reverts, so we never record money we didn't get.
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
    /// It takes `recipient` because Soroban has no implicit caller. Naming the address and
    /// requiring its signature is what makes it safe.
    pub fn claim(env: Env, recipient: Address) {
        let to = recipient.clone();
        pay_out(&env, recipient, to);
    }

    /// Pays to another address, for a recipient whose own account can't receive yet. Still
    /// needs the recipient's signature, since only they decide where their funds go.
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

    // Clear first. If the transfer fails (usually no USDC trustline), everything reverts and
    // the entry comes back.
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

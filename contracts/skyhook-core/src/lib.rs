#![no_std]
#[cfg(test)]
extern crate std;

use soroban_sdk::{
    auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation},
    contract, contractevent, contractimpl, symbol_short, token, vec, Address, Bytes, BytesN, Env,
    IntoVal, Symbol,
};

mod fixtures;
mod parse;
mod registry;
mod storage;

use storage::{DataKey, TTL_EXTEND_TO_LEDGERS, TTL_THRESHOLD_LEDGERS};

// The core contract. It mints through the CCTP forwarder, reads the instruction from the
// message, and sends the USDC to the named handler. If that fails it falls back, so minted
// funds are never lost and never revert the transfer.

const FORWARDER: Symbol = symbol_short!("FWD");
const TOKEN: Symbol = symbol_short!("TOKEN");

/// Registry id of the Hold handler. Every failure tries Hold before recording funds as unresolved.
const HOLD_HANDLER_ID: u32 = 2;

/// The funds could not be delivered and stayed in this contract. `recipient` is `None` when the
/// instruction was too broken to read one; the funds are then recorded against the CCTP nonce.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Unresolved {
    pub recipient: Option<Address>,
    pub amount: i128,
}

/// A recipient collected unresolved funds. `to` differs from `recipient` when they were paid
/// to another address.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UnresolvedClaimed {
    pub recipient: Address,
    pub to: Address,
    pub amount: i128,
}

#[contract]
pub struct SkyhookCore;

#[contractimpl]
impl SkyhookCore {
    /// Both values are set once and never change. Neither is an admin key: `forwarder` is the
    /// only contract whose mints we accept, and `token` is the USDC contract.
    pub fn __constructor(env: Env, forwarder: Address, token: Address) {
        env.storage().instance().set(&FORWARDER, &forwarder);
        env.storage().instance().set(&TOKEN, &token);
    }

    /// Mints through the forwarder, then runs the instruction in the message.
    ///
    /// Once the mint succeeds this never panics. The whole fallback ladder exists for that.
    pub fn execute(env: Env, message: Bytes, attestation: Bytes) {
        let forwarder: Address = env.storage().instance().get(&FORWARDER).unwrap();
        let token: Address = env.storage().instance().get(&TOKEN).unwrap();
        let me = env.current_contract_address();
        let token_client = token::TokenClient::new(&env, &token);

        let before = token_client.balance(&me);
        // Not caught on purpose: if the mint fails, the transaction should revert.
        // Only handler failures are caught.
        env.invoke_contract::<()>(
            &forwarder,
            &Symbol::new(&env, "mint_and_forward"),
            (message.clone(), attestation).into_val(&env),
        );
        // Use the balance change, not the message's amount. That covers Circle's 6 to 7
        // decimal scaling and any fee taken on the way.
        let amount = token_client.balance(&me) - before;

        // Level 1: the handler the sender named.
        let recipient = match parse::parse(&env, &message) {
            parse::Parsed::Instruction(ix) => {
                if let Some(handler) = registry::resolve(&env, ix.handler_id) {
                    if try_run(&env, &token, &handler, &ix.fallback_recipient, amount, &ix.params) {
                        return;
                    }
                }
                Some(ix.fallback_recipient)
            }
            parse::Parsed::Malformed { fallback_recipient } => fallback_recipient,
        };

        // Level 2: Hold, if we know who to credit.
        if let Some(r) = &recipient {
            if let Some(hold) = registry::resolve(&env, HOLD_HANDLER_ID) {
                if try_run(&env, &token, &hold, r, amount, &Bytes::new(&env)) {
                    return;
                }
            }
        }

        // Level 3: keep the funds here and record the owner. Only a storage write, so it
        // cannot fail.
        record_unresolved(&env, recipient, &message, amount);
    }

    /// Anyone can register, and ids can't be overwritten. Panics if `id` is taken.
    pub fn register_handler(env: Env, id: u32, contract: Address) {
        registry::register_handler(&env, id, contract);
    }

    /// Undelivered funds recorded for a recipient.
    pub fn unresolved_by_recipient(env: Env, recipient: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::UnresolvedByRecipient(recipient))
            .unwrap_or(0)
    }

    /// Undelivered funds recorded for a nonce, when no recipient could be read.
    pub fn unresolved_by_nonce(env: Env, nonce: BytesN<32>) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::UnresolvedByNonce(nonce))
            .unwrap_or(0)
    }

    /// Lets a recipient collect their unresolved funds, paid to `to`. That is usually their own
    /// address, or another one if theirs still can't receive.
    ///
    /// Funds recorded against a nonce can't be collected, here or anywhere. Nobody can prove a
    /// nonce is theirs, and deciding who gets it would need an admin, which this contract does
    /// not have.
    pub fn claim_unresolved(env: Env, recipient: Address, to: Address) {
        recipient.require_auth();

        let key = DataKey::UnresolvedByRecipient(recipient.clone());
        let amount: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        if amount <= 0 {
            panic!("nothing unresolved for this recipient");
        }

        // Clear first. If the transfer fails (usually no USDC trustline), everything reverts
        // and the record comes back.
        env.storage().persistent().remove(&key);

        let token: Address = env.storage().instance().get(&TOKEN).unwrap();
        token::TokenClient::new(&env, &token).transfer(
            &env.current_contract_address(),
            &to,
            &amount,
        );

        UnresolvedClaimed {
            recipient,
            to,
            amount,
        }
        .publish(&env);
    }
}

/// Lets `handler` pull exactly `amount` from this contract, then calls it. Returns whether it
/// worked. Failures are caught here so `execute` never panics.
///
/// The handler pulls the funds itself, so if it panics the transfer rolls back with it. We
/// can't transfer first and call after: Soroban blocks a contract from calling itself, and a
/// transfer made in our own frame would survive the handler's rollback and strand the funds.
fn try_run(
    env: &Env,
    token: &Address,
    handler: &Address,
    recipient: &Address,
    amount: i128,
    params: &Bytes,
) -> bool {
    let me = env.current_contract_address();

    // Covers only this transfer (this from, to and amount), and only once.
    env.authorize_as_current_contract(vec![
        env,
        InvokerContractAuthEntry::Contract(SubContractInvocation {
            context: ContractContext {
                contract: token.clone(),
                fn_name: Symbol::new(env, "transfer"),
                args: (me, handler.clone(), amount).into_val(env),
            },
            sub_invocations: vec![env],
        }),
    ]);

    let result = env.try_invoke_contract::<(), soroban_sdk::Error>(
        handler,
        &Symbol::new(env, "execute"),
        (recipient.clone(), amount, params.clone()).into_val(env),
    );
    matches!(result, Ok(Ok(())))
}

/// Level 3: the funds stay here and we record who they belong to. Only a storage write, so
/// nothing can fail.
fn record_unresolved(env: &Env, recipient: Option<Address>, message: &Bytes, amount: i128) {
    let key = match &recipient {
        Some(r) => Some(DataKey::UnresolvedByRecipient(r.clone())),
        // No recipient, so use the CCTP nonce. It can be read from the outer message no matter
        // how broken the instruction is.
        None => parse::nonce(message).map(DataKey::UnresolvedByNonce),
    };

    if let Some(key) = key {
        let current: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        env.storage().persistent().set(&key, &(current + amount));
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD_LEDGERS, TTL_EXTEND_TO_LEDGERS);
    }
    // If even the nonce is unreadable the funds still stay here. In practice a message the
    // forwarder accepted always has one.

    Unresolved { recipient, amount }.publish(env);
}

mod test;

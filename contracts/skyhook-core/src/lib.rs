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

// Core Skyhook contract. Calls the CCTP forwarder, reads its own instruction out of the
// resulting message, and routes the arriving USDC to the named handler — falling back so that
// minted funds are never lost and never cause the transfer to revert (ARCHITECTURE.md §4).

const FORWARDER: Symbol = symbol_short!("FWD");
const TOKEN: Symbol = symbol_short!("TOKEN");

/// The Hold handler's registry id (SPEC.md §3). Every failure path routes here before giving
/// up and recording the funds as unresolved.
const HOLD_HANDLER_ID: u32 = 2;

/// Emitted when the ladder could not deliver the funds and they stayed in this contract
/// (ARCHITECTURE.md §4, Level 3). `recipient` is absent when the instruction was too corrupt to
/// recover one, in which case the funds are recorded against the CCTP nonce instead.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Unresolved {
    pub recipient: Option<Address>,
    pub amount: i128,
}

/// Emitted when a recipient recovers funds that had come to rest at Level 3. `to` differs from
/// `recipient` when the payout was redirected to an address that could actually receive.
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
    /// Both values are set once at deploy time and immutable thereafter (ARCHITECTURE.md §3).
    /// Neither is an admin key: `forwarder` is the only contract whose mints are accepted, and
    /// `token` is the USDC SAC the core measures and moves.
    pub fn __constructor(env: Env, forwarder: Address, token: Address) {
        env.storage().instance().set(&FORWARDER, &forwarder);
        env.storage().instance().set(&TOKEN, &token);
    }

    /// Mints through the forwarder, then executes the instruction attached to the message.
    ///
    /// Never panics once the mint has succeeded — that is the invariant the whole fallback
    /// ladder exists to hold (ARCHITECTURE.md §4).
    pub fn execute(env: Env, message: Bytes, attestation: Bytes) {
        let forwarder: Address = env.storage().instance().get(&FORWARDER).unwrap();
        let token: Address = env.storage().instance().get(&TOKEN).unwrap();
        let me = env.current_contract_address();
        let token_client = token::TokenClient::new(&env, &token);

        let before = token_client.balance(&me);
        // Deliberately NOT caught: if the mint itself fails, the whole transaction must
        // revert. Only *handler* failures are caught, below.
        env.invoke_contract::<()>(
            &forwarder,
            &Symbol::new(&env, "mint_and_forward"),
            (message.clone(), attestation).into_val(&env),
        );
        // Balance delta rather than the message's `amount` field: this absorbs Circle's 6->7
        // decimal scaling and any fee deducted on the way, with no assumptions.
        let amount = token_client.balance(&me) - before;

        // Level 1 — the handler the sender named.
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

        // Level 2 — route to Hold, provided we recovered someone to credit.
        if let Some(r) = &recipient {
            if let Some(hold) = registry::resolve(&env, HOLD_HANDLER_ID) {
                if try_run(&env, &token, &hold, r, amount, &Bytes::new(&env)) {
                    return;
                }
            }
        }

        // Level 3 — keep the funds here and record who they belong to. No transfer and no
        // external call, so this cannot itself fail.
        record_unresolved(&env, recipient, &message, amount);
    }

    /// Permissionless, append-only. Panics if `id` is already bound (ARCHITECTURE.md §3).
    pub fn register_handler(env: Env, id: u32, contract: Address) {
        registry::register_handler(&env, id, contract);
    }

    /// Funds the ladder could not deliver, held against a recovered recipient.
    pub fn unresolved_by_recipient(env: Env, recipient: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::UnresolvedByRecipient(recipient))
            .unwrap_or(0)
    }

    /// Funds the ladder could not deliver when no recipient could be recovered at all.
    pub fn unresolved_by_nonce(env: Env, nonce: BytesN<32>) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::UnresolvedByNonce(nonce))
            .unwrap_or(0)
    }

    /// The way out of Level 3: the recipient the funds were recorded against collects them,
    /// paying to `to` — their own address in the ordinary case, or a provisioned one if their
    /// own still cannot receive.
    ///
    /// Without this, "the funds are never lost" would be true only in the narrowest sense:
    /// they would sit in this contract permanently, out of everyone's reach
    /// (`ARCHITECTURE.md` §4 says they sit here *until claimed* — this is the claiming).
    ///
    /// **Funds recorded against a CCTP nonce rather than a recipient cannot be recovered
    /// through here, or anywhere else.** That case only arises when an instruction was too
    /// malformed to yield a recipient at all, and nobody can prove a nonce belongs to them.
    /// Letting someone withdraw them would mean appointing an authority to decide who — which
    /// is precisely the admin key this contract is built not to have. See `SPEC.md` §2.
    pub fn claim_unresolved(env: Env, recipient: Address, to: Address) {
        recipient.require_auth();

        let key = DataKey::UnresolvedByRecipient(recipient.clone());
        let amount: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        if amount <= 0 {
            panic!("nothing unresolved for this recipient");
        }

        // Clear before paying out. If the payout fails — a recipient without a USDC trustline
        // being the expected case — the whole invocation reverts and the record is restored.
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

/// Invokes `handler`, having first authorized it to pull exactly `amount` from this contract —
/// and nothing else. Returns whether it succeeded; any failure is caught here rather than
/// propagating, which is what keeps `execute` panic-free.
///
/// The handler pulls the funds inside its own invocation rather than receiving them
/// beforehand, so that a panicking handler rolls the transfer back along with the rest of its
/// frame. The core cannot instead wrap "transfer then call" in a sub-invocation of its own:
/// Soroban runs contracts with `ContractReentryMode::Prohibited`, so a contract cannot call
/// itself, and a transfer made in the core's own frame would survive the handler's rollback and
/// strand the funds.
fn try_run(
    env: &Env,
    token: &Address,
    handler: &Address,
    recipient: &Address,
    amount: i128,
    params: &Bytes,
) -> bool {
    let me = env.current_contract_address();

    // Scoped to this exact transfer: this `from`, this `to`, this `amount`. The handler cannot
    // move anything else of ours, nor move this twice — the entry is consumed once.
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

/// Level 3 of the ladder: the funds stay in this contract's balance and we record who they are
/// for. Storage write only — no transfer, no external call, nothing that can fail.
fn record_unresolved(env: &Env, recipient: Option<Address>, message: &Bytes, amount: i128) {
    let key = match &recipient {
        Some(r) => Some(DataKey::UnresolvedByRecipient(r.clone())),
        // No recipient recoverable — fall back to the CCTP nonce, which is readable from the
        // outer message however corrupt the instruction was.
        None => parse::nonce(message).map(DataKey::UnresolvedByNonce),
    };

    if let Some(key) = key {
        let current: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        env.storage().persistent().set(&key, &(current + amount));
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD_LEDGERS, TTL_EXTEND_TO_LEDGERS);
    }
    // If even the nonce was unreadable the funds still simply stay here, which satisfies the
    // invariant; a message that `mint_and_forward` accepted always carries one, so in practice
    // this does not arise.

    Unresolved { recipient, amount }.publish(env);
}

mod test;

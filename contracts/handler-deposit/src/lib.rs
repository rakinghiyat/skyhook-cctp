#![no_std]
#[cfg(test)]
extern crate std;

use soroban_sdk::{
    auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation},
    contract, contractevent, contractimpl, symbol_short, token, vec, Address, Bytes, Env, IntoVal,
    Symbol,
};

// The Deposit handler (SPEC.md §3, `handler_id = 1`).
//
// Places arriving USDC into a SEP-56 vault for the recipient, in the same execution that
// delivered it. This is the handler that makes the project's actual claim true: USDC crossing
// over CCTP goes to work on arrival instead of waiting for a second transaction.
//
// It targets the **SEP-56 interface**, never one particular vault. The vault's address travels
// in the instruction, so any conforming vault works without changing this contract — the
// reference vault in this workspace is for testing and the demo, not a hardcoded destination.
//
// Worth noting about who can receive: the recipient is credited with vault *shares*, which live
// in the vault's own storage. Unlike a USDC payout, that needs no trustline — so Deposit can
// reach recipients that Hold's `claim` cannot.

const CORE: Symbol = symbol_short!("CORE");
const TOKEN: Symbol = symbol_short!("TOKEN");

/// A Stellar strkey is always 56 ASCII bytes. `params` is exactly the vault's (SPEC.md §3).
const VAULT_STRKEY_LEN: u32 = 56;

/// Emitted once the vault has credited the recipient.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Deposited {
    pub recipient: Address,
    pub vault: Address,
    pub assets: i128,
    pub shares: i128,
}

#[contract]
pub struct HandlerDeposit;

#[contractimpl]
impl HandlerDeposit {
    /// Both set once at deploy time and immutable thereafter. `core` is the only contract this
    /// handler will ever collect funds from.
    pub fn __constructor(env: Env, core: Address, token: Address) {
        env.storage().instance().set(&CORE, &core);
        env.storage().instance().set(&TOKEN, &token);
    }

    /// Called by the core. Collects the funds it authorized, then deposits them into the vault
    /// named in `params`, with the shares going to `recipient`.
    ///
    /// Panicking is how a handler refuses (SPEC.md §4): if `params` is malformed, or the named
    /// address is not a vault, or the deposit reverts for any reason, this call fails and the
    /// core routes the funds to Hold instead. Nothing needs to be caught here.
    ///
    /// No "only the core may call this" check is needed: the collection below is
    /// `transfer(core, self, amount)` for the `core` fixed at construction, so it can only
    /// succeed inside an invocation that particular core authorized.
    pub fn execute(env: Env, recipient: Address, amount: i128, params: Bytes) {
        let vault = vault_from_params(&params);

        let core: Address = env.storage().instance().get(&CORE).unwrap();
        let token: Address = env.storage().instance().get(&TOKEN).unwrap();
        let me = env.current_contract_address();

        // Collect what the core authorized.
        token::TokenClient::new(&env, &token).transfer(&core, &me, &amount);

        // The vault will move the assets out of us from inside its own frame — a deeper call
        // than ours, so it needs explicit authorization. Scoped to this exact transfer, the
        // same way the core scopes what it authorizes us to take.
        env.authorize_as_current_contract(vec![
            &env,
            InvokerContractAuthEntry::Contract(SubContractInvocation {
                context: ContractContext {
                    contract: token.clone(),
                    fn_name: Symbol::new(&env, "transfer"),
                    args: (me.clone(), vault.clone(), amount).into_val(&env),
                },
                sub_invocations: vec![&env],
            }),
        ]);

        // SEP-56: deposit(assets, receiver, from, operator) -> shares. Passing `from` and
        // `operator` as ourselves keeps the vault on its direct-transfer path rather than
        // requiring an allowance.
        let shares: i128 = env.invoke_contract(
            &vault,
            &Symbol::new(&env, "deposit"),
            (amount, recipient.clone(), me.clone(), me).into_val(&env),
        );

        Deposited {
            recipient,
            vault,
            assets: amount,
            shares,
        }
        .publish(&env);
    }
}

/// `params` is the vault address as a 56-byte strkey (SPEC.md §3). Anything else is a
/// malformed instruction, and panicking is the correct response — the core catches it and the
/// funds go to Hold rather than to an address we cannot verify.
fn vault_from_params(params: &Bytes) -> Address {
    if params.len() != VAULT_STRKEY_LEN {
        panic!("params must be a 56-byte vault strkey");
    }
    let mut buf = [0u8; VAULT_STRKEY_LEN as usize];
    params.copy_into_slice(&mut buf);
    let s = match core::str::from_utf8(&buf) {
        Ok(s) => s,
        Err(_) => panic!("vault strkey is not valid ASCII"),
    };
    if stellar_strkey::Contract::from_string(s).is_err() {
        panic!("vault is not a valid contract strkey");
    }
    Address::from_string_bytes(params)
}

mod test;

#![no_std]
#[cfg(test)]
extern crate std;

use soroban_sdk::{
    auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation},
    contract, contractevent, contractimpl, symbol_short, token, vec, Address, Bytes, Env, IntoVal,
    Symbol,
};

// The Deposit handler (`handler_id = 1`).
//
// Deposits arriving USDC into a SEP-56 vault for the recipient, in the same transaction that
// delivered it. So USDC from CCTP starts working on arrival, with no second transaction.
//
// It works with any SEP-56 vault. The vault address comes in the instruction; the reference
// vault in this workspace is only for tests and the demo.
//
// The recipient gets vault shares, which live in the vault's storage. That needs no trustline,
// so Deposit can reach recipients that Hold's `claim` can't.

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
    /// Both are set once and never change. `core` is the only contract this handler pulls from.
    pub fn __constructor(env: Env, core: Address, token: Address) {
        env.storage().instance().set(&CORE, &core);
        env.storage().instance().set(&TOKEN, &token);
    }

    /// Called by the core. Pulls the authorized funds and deposits them into the vault named in
    /// `params`, with shares going to `recipient`.
    ///
    /// A handler refuses by panicking. Bad `params`, a non-vault address or a failed deposit
    /// all panic, and the core sends the funds to Hold instead.
    ///
    /// No caller check is needed. The pull is `transfer(core, self, amount)` from our own core,
    /// so it only works when that core authorized it.
    pub fn execute(env: Env, recipient: Address, amount: i128, params: Bytes) {
        let vault = vault_from_params(&params);

        let core: Address = env.storage().instance().get(&CORE).unwrap();
        let token: Address = env.storage().instance().get(&TOKEN).unwrap();
        let me = env.current_contract_address();

        // Check the vault before touching the funds. A contract without `query_asset` isn't a
        // vault, and a vault for another asset would mint the wrong shares.
        //
        // Checking first also keeps a refusal cheap. The whole ladder shares one budget, so a
        // handler that pulls funds and only then fails can use it up and revert everything.
        let vault_asset: Address = env.invoke_contract(
            &vault,
            &Symbol::new(&env, "query_asset"),
            soroban_sdk::Vec::new(&env),
        );
        if vault_asset != token {
            panic!("vault's underlying asset is not the token being delivered");
        }

        // Collect what the core authorized.
        token::TokenClient::new(&env, &token).transfer(&core, &me, &amount);

        // The vault pulls the funds from us in a deeper call, so it needs explicit auth. It
        // covers only this transfer, like the core does for us.
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

        // SEP-56: deposit(assets, receiver, from, operator) -> shares. Using ourselves for
        // `from` and `operator` means no allowance is needed.
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

/// `params` is the vault address as a 56-byte strkey. Anything else panics, and the core sends
/// the funds to Hold.
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

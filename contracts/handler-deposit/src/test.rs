#![cfg(test)]

use super::*;
use reference_vault::{ReferenceVault, ReferenceVaultClient};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{contract, contractimpl, token, Address, Bytes, Env, String};

const DELIVERED: i128 = 10_000_000;

// ---------------------------------------------------------------------------------------
// A stand-in for skyhook-core: authorizes exactly one pull, then invokes the handler. Mirrors
// `try_run` in contracts/skyhook-core/src/lib.rs.
// ---------------------------------------------------------------------------------------

#[contract]
pub struct MockCore;

#[contractimpl]
impl MockCore {
    pub fn __constructor(env: Env, token: Address) {
        env.storage().instance().set(&TOKEN, &token);
    }

    pub fn run(env: Env, handler: Address, recipient: Address, amount: i128, params: Bytes) {
        let token: Address = env.storage().instance().get(&TOKEN).unwrap();
        let me = env.current_contract_address();

        env.authorize_as_current_contract(vec![
            &env,
            InvokerContractAuthEntry::Contract(SubContractInvocation {
                context: ContractContext {
                    contract: token.clone(),
                    fn_name: Symbol::new(&env, "transfer"),
                    args: (me, handler.clone(), amount).into_val(&env),
                },
                sub_invocations: vec![&env],
            }),
        ]);

        env.invoke_contract::<()>(
            &handler,
            &Symbol::new(&env, "execute"),
            (recipient, amount, params).into_val(&env),
        );
    }
}

/// Stands in for a contract that is not a vault at all.
#[contract]
pub struct NotAVault;

#[contractimpl]
impl NotAVault {
    pub fn hello(_env: Env) {}
}

// ---------------------------------------------------------------------------------------
// Rig
// ---------------------------------------------------------------------------------------

struct Rig {
    env: Env,
    handler: Address,
    core: Address,
    token: Address,
    vault: Address,
    recipient: Address,
}

impl Rig {
    fn new() -> Rig {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let token = env.register_stellar_asset_contract_v2(admin).address();
        let core = env.register(MockCore, (&token,));
        token::StellarAssetClient::new(&env, &token).mint(&core, &(DELIVERED * 4));

        let handler = env.register(HandlerDeposit, (&core, &token));

        // The real reference vault, not a mock — testing against a stub would only prove the
        // handler can talk to a stub.
        let vault = env.register(
            ReferenceVault,
            (
                String::from_str(&env, "Skyhook Reference Vault"),
                String::from_str(&env, "skUSDC"),
                token.clone(),
                0u32,
            ),
        );

        let recipient = Address::generate(&env);
        Rig {
            env,
            handler,
            core,
            token,
            vault,
            recipient,
        }
    }

    fn arm(&self) {
        self.env.set_auths(&[]);
    }

    /// The vault's address as the 56-byte strkey the instruction carries (SPEC.md §3).
    fn params_for(&self, vault: &Address) -> Bytes {
        let s = vault.to_string();
        let mut buf = [0u8; 56];
        s.copy_into_slice(&mut buf);
        Bytes::from_slice(&self.env, &buf)
    }

    fn deliver_with(&self, params: Bytes) {
        MockCoreClient::new(&self.env, &self.core).run(
            &self.handler,
            &self.recipient,
            &DELIVERED,
            &params,
        );
    }

    fn deliver(&self) {
        self.deliver_with(self.params_for(&self.vault.clone()));
    }

    fn usdc(&self, who: &Address) -> i128 {
        token::TokenClient::new(&self.env, &self.token).balance(who)
    }

    fn shares(&self, who: &Address) -> i128 {
        ReferenceVaultClient::new(&self.env, &self.vault).balance(who)
    }
}

// ---------------------------------------------------------------------------------------

#[test]
fn deposit_credits_the_recipient_with_shares() {
    let rig = Rig::new();
    rig.arm();

    rig.deliver();

    assert!(rig.shares(&rig.recipient) > 0, "the recipient must end up holding vault shares");
    assert_eq!(
        rig.usdc(&rig.vault),
        DELIVERED,
        "the vault must hold the underlying USDC"
    );
    assert_eq!(rig.usdc(&rig.handler), 0, "the handler keeps nothing");
    assert_eq!(rig.usdc(&rig.recipient), 0, "the recipient is paid in shares, not USDC");
}

// Not tested here: that the recipient needs no USDC trustline to be credited. The test
// environment gives out contract addresses, which never need trustlines in the first place, so
// any test of it would pass vacuously. It is a property of where the balance lives — shares sit
// in the vault's own storage — and the honest place to demonstrate it is on Testnet with a real
// G-address. See docs/EVIDENCE.md §4.

#[test]
fn repeated_deposits_accumulate_shares() {
    let rig = Rig::new();
    rig.arm();

    rig.deliver();
    let first = rig.shares(&rig.recipient);
    rig.deliver();

    assert!(rig.shares(&rig.recipient) > first);
    assert_eq!(rig.usdc(&rig.vault), DELIVERED * 2);
}

#[test]
fn a_params_naming_something_that_is_not_a_vault_fails() {
    let rig = Rig::new();
    let impostor = rig.env.register(NotAVault, ());
    rig.arm();

    let result = MockCoreClient::new(&rig.env, &rig.core).try_run(
        &rig.handler,
        &rig.recipient,
        &DELIVERED,
        &rig.params_for(&impostor),
    );

    assert!(result.is_err(), "depositing into a non-vault must fail, not silently succeed");
    assert_eq!(rig.usdc(&rig.handler), 0, "and the handler must keep nothing");
    assert_eq!(rig.shares(&rig.recipient), 0);
}

#[test]
fn params_of_the_wrong_length_fails() {
    let rig = Rig::new();
    rig.arm();

    let result = MockCoreClient::new(&rig.env, &rig.core).try_run(
        &rig.handler,
        &rig.recipient,
        &DELIVERED,
        &Bytes::from_slice(&rig.env, &[1u8; 10]),
    );

    assert!(result.is_err());
    assert_eq!(rig.usdc(&rig.handler), 0);
}

#[test]
fn params_that_are_not_a_valid_strkey_fails() {
    let rig = Rig::new();
    rig.arm();

    // Right length, wrong content.
    let result = MockCoreClient::new(&rig.env, &rig.core).try_run(
        &rig.handler,
        &rig.recipient,
        &DELIVERED,
        &Bytes::from_slice(&rig.env, &[b'Z'; 56]),
    );

    assert!(result.is_err());
    assert_eq!(rig.usdc(&rig.handler), 0);
}

#[test]
fn execute_from_an_unauthorized_caller_moves_nothing() {
    let rig = Rig::new();
    let impostor = rig.env.register(MockCore, (&rig.token,));
    token::StellarAssetClient::new(&rig.env, &rig.token).mint(&impostor, &DELIVERED);
    rig.arm();

    let result = MockCoreClient::new(&rig.env, &impostor).try_run(
        &rig.handler,
        &rig.recipient,
        &DELIVERED,
        &rig.params_for(&rig.vault.clone()),
    );

    assert!(result.is_err(), "only the core it was built for can deliver funds");
    assert_eq!(rig.shares(&rig.recipient), 0);
    assert_eq!(rig.usdc(&rig.vault), 0);
}

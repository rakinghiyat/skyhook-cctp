#![cfg(test)]

use super::*;
use crate::fixtures;
use soroban_sdk::testutils::{Address as _, Events};
use soroban_sdk::{contract, contractimpl, token, Address, Bytes, Env, Event};

/// What the mock forwarder delivers on each `mint_and_forward`, at Stellar's 7 decimals.
const MINTED: i128 = 10_000_000;

// ---------------------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------------------

/// Stands in for Circle's `CctpForwarder`: hands its pre-funded USDC to a target on
/// `mint_and_forward`, the same way the real one credits `forwardRecipient`.
#[contract]
pub struct MockForwarder;

#[contractimpl]
impl MockForwarder {
    pub fn __constructor(env: Env, token: Address) {
        env.storage().instance().set(&symbol_short!("TOK"), &token);
    }

    pub fn set_target(env: Env, target: Address) {
        env.storage().instance().set(&symbol_short!("TGT"), &target);
    }

    pub fn mint_and_forward(env: Env, _message: Bytes, _attestation: Bytes) {
        let tok: Address = env.storage().instance().get(&symbol_short!("TOK")).unwrap();
        let target: Address = env.storage().instance().get(&symbol_short!("TGT")).unwrap();
        token::TokenClient::new(&env, &tok).transfer(
            &env.current_contract_address(),
            &target,
            &MINTED,
        );
    }
}

/// Pulls the funds the core authorized it for, and keeps them. A handler knows its core and
/// token at construction (SPEC.md §4), which is what lets `execute` keep its published shape.
#[contract]
pub struct HandlerOk;

#[contractimpl]
impl HandlerOk {
    pub fn __constructor(env: Env, core: Address, token: Address) {
        env.storage().instance().set(&symbol_short!("CORE"), &core);
        env.storage().instance().set(&symbol_short!("TOK"), &token);
    }

    pub fn execute(env: Env, _recipient: Address, amount: i128, _params: Bytes) {
        pull(&env, amount);
    }
}

/// Pulls the funds and *then* rejects. Panicking is the legitimate way to refuse (SPEC.md §4);
/// pulling first is what makes this a real test of the rollback boundary.
#[contract]
pub struct HandlerPanics;

#[contractimpl]
impl HandlerPanics {
    pub fn __constructor(env: Env, core: Address, token: Address) {
        env.storage().instance().set(&symbol_short!("CORE"), &core);
        env.storage().instance().set(&symbol_short!("TOK"), &token);
    }

    pub fn execute(env: Env, _recipient: Address, amount: i128, _params: Bytes) {
        pull(&env, amount);
        panic!("handler rejected this instruction");
    }
}

fn pull(env: &Env, amount: i128) {
    let core: Address = env.storage().instance().get(&symbol_short!("CORE")).unwrap();
    let tok: Address = env.storage().instance().get(&symbol_short!("TOK")).unwrap();
    token::TokenClient::new(env, &tok).transfer(&core, &env.current_contract_address(), &amount);
}

// ---------------------------------------------------------------------------------------
// Rig
// ---------------------------------------------------------------------------------------

struct Rig {
    env: Env,
    core: Address,
    token: Address,
    forwarder: Address,
    recipient: Address,
}

impl Rig {
    /// Auth is mocked only while wiring the rig up. Every test then calls `arm()` to switch
    /// mocking off, so the core's scoped authorization of each handler pull is genuinely
    /// exercised rather than waved through.
    fn new() -> Rig {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let token = env.register_stellar_asset_contract_v2(admin).address();
        let forwarder = env.register(MockForwarder, (&token,));
        token::StellarAssetClient::new(&env, &token).mint(&forwarder, &MINTED);

        let core = env.register(SkyhookCore, (&forwarder, &token));
        MockForwarderClient::new(&env, &forwarder).set_target(&core);

        let recipient = Address::generate(&env);
        Rig {
            env,
            core,
            token,
            forwarder,
            recipient,
        }
    }

    /// Disables auth mocking. Anything after this must stand on its own authorization.
    fn arm(&self) {
        self.env.set_auths(&[]);
    }

    fn client(&self) -> SkyhookCoreClient<'_> {
        SkyhookCoreClient::new(&self.env, &self.core)
    }

    fn handler_ok(&self) -> Address {
        self.env.register(HandlerOk, (&self.core, &self.token))
    }

    fn handler_panics(&self) -> Address {
        self.env.register(HandlerPanics, (&self.core, &self.token))
    }

    fn register(&self, id: u32, handler: &Address) {
        self.client().register_handler(&id, handler);
    }

    fn balance(&self, who: &Address) -> i128 {
        token::TokenClient::new(&self.env, &self.token).balance(who)
    }

    /// Executes with a well-formed instruction naming `handler_id`.
    fn execute_naming(&self, handler_id: u32) {
        let envelope = fixtures::envelope(&self.recipient, handler_id, &[]);
        let message = fixtures::message(&self.env, &self.core, &envelope);
        self.client()
            .execute(&message, &Bytes::new(&self.env));
    }

    /// The invariant, asserted after every scenario: nothing was destroyed. Every unit the
    /// forwarder handed over is still accounted for somewhere.
    fn assert_nothing_lost(&self, holders: &[&Address]) {
        let mut total = self.balance(&self.forwarder) + self.balance(&self.core);
        for h in holders {
            total += self.balance(h);
        }
        assert_eq!(
            total, MINTED,
            "minted funds must never be lost: expected {MINTED} accounted for, found {total}"
        );
    }
}

// ---------------------------------------------------------------------------------------
// Level 1 — the named handler succeeds
// ---------------------------------------------------------------------------------------

#[test]
fn level_1_named_handler_receives_the_funds() {
    let rig = Rig::new();
    let handler = rig.handler_ok();
    rig.register(1, &handler);
    rig.arm();

    rig.execute_naming(1);

    assert_eq!(rig.balance(&handler), MINTED, "handler should hold the funds");
    assert_eq!(rig.balance(&rig.core), 0, "core should not retain anything");
    rig.assert_nothing_lost(&[&handler]);
}

// ---------------------------------------------------------------------------------------
// Level 2 — fall through to Hold
// ---------------------------------------------------------------------------------------

#[test]
fn level_2_failing_handler_routes_to_hold_and_rolls_back_its_transfer() {
    let rig = Rig::new();
    let failing = rig.handler_panics();
    let hold = rig.handler_ok();
    rig.register(1, &failing);
    rig.register(HOLD_HANDLER_ID, &hold);
    rig.arm();

    rig.execute_naming(1);

    // The whole point of having the handler pull inside its own invocation: the transfer it
    // made must roll back along with its frame, not stay stranded there.
    assert_eq!(
        rig.balance(&failing),
        0,
        "transfer to the failing handler must roll back with it"
    );
    assert_eq!(rig.balance(&hold), MINTED, "Hold should have received the funds");
    assert_eq!(rig.balance(&rig.core), 0);
    rig.assert_nothing_lost(&[&failing, &hold]);
}

#[test]
fn level_2_unrecognized_handler_id_routes_to_hold() {
    let rig = Rig::new();
    let hold = rig.handler_ok();
    rig.register(HOLD_HANDLER_ID, &hold);
    rig.arm();

    // 99 was never registered.
    rig.execute_naming(99);

    assert_eq!(rig.balance(&hold), MINTED);
    rig.assert_nothing_lost(&[&hold]);
}

#[test]
fn level_2_malformed_instruction_routes_to_hold() {
    let rig = Rig::new();
    let hold = rig.handler_ok();
    rig.register(HOLD_HANDLER_ID, &hold);
    rig.arm();

    // Well-formed enough to recover the recipient, but the version is unrecognized.
    let mut envelope = fixtures::envelope(&rig.recipient, 1, &[]);
    envelope[0] = 0x99;
    let message = fixtures::message(&rig.env, &rig.core, &envelope);
    rig.client().execute(&message, &Bytes::new(&rig.env));

    assert_eq!(rig.balance(&hold), MINTED);
    rig.assert_nothing_lost(&[&hold]);
}

// ---------------------------------------------------------------------------------------
// Level 3 — nothing could take the funds, so they stay here
// ---------------------------------------------------------------------------------------

#[test]
fn level_3_hold_also_fails_records_against_recipient() {
    let rig = Rig::new();
    let failing = rig.handler_panics();
    let failing_hold = rig.handler_panics();
    rig.register(1, &failing);
    rig.register(HOLD_HANDLER_ID, &failing_hold);
    rig.arm();

    rig.execute_naming(1);

    assert_eq!(
        rig.balance(&rig.core),
        MINTED,
        "funds must remain in the core when nothing can take them"
    );
    assert_eq!(rig.balance(&failing), 0);
    assert_eq!(rig.balance(&failing_hold), 0);
    assert_eq!(
        rig.client().unresolved_by_recipient(&rig.recipient),
        MINTED,
        "the funds must be recorded against the recipient we recovered"
    );
    rig.assert_nothing_lost(&[&failing, &failing_hold]);
}

#[test]
fn level_3_no_handlers_registered_at_all() {
    let rig = Rig::new();
    rig.arm();

    // Nothing registered, not even Hold — the ladder has nowhere to go.
    rig.execute_naming(1);

    assert_eq!(rig.balance(&rig.core), MINTED);
    assert_eq!(rig.client().unresolved_by_recipient(&rig.recipient), MINTED);
    rig.assert_nothing_lost(&[]);
}

#[test]
fn level_3_unrecoverable_recipient_records_against_nonce() {
    let rig = Rig::new();
    let hold = rig.handler_ok();
    rig.register(HOLD_HANDLER_ID, &hold);
    rig.arm();

    // Too short to yield even a fallback_recipient, so Hold cannot be told who to credit.
    let envelope = std::vec![0x01u8; 10];
    let message = fixtures::message(&rig.env, &rig.core, &envelope);
    rig.client().execute(&message, &Bytes::new(&rig.env));

    assert_eq!(
        rig.balance(&rig.core),
        MINTED,
        "with no recipient to credit, the funds stay put"
    );
    assert_eq!(rig.balance(&hold), 0);
    assert_eq!(
        rig.client()
            .unresolved_by_nonce(&fixtures::test_nonce(&rig.env)),
        MINTED,
        "funds must fall back to being keyed by the CCTP nonce"
    );
    rig.assert_nothing_lost(&[&hold]);
}

#[test]
fn level_3_emits_unresolved_event() {
    let rig = Rig::new();
    rig.arm();
    rig.execute_naming(1);

    // A caught failure that left no trace is indistinguishable from one that never happened.
    let expected = Unresolved {
        recipient: Some(rig.recipient.clone()),
        amount: MINTED,
    }
    .to_xdr(&rig.env, &rig.core);

    assert!(
        rig.env.events().all().events().contains(&expected),
        "reaching Level 3 must emit Unresolved naming the recipient and amount"
    );
}

// ---------------------------------------------------------------------------------------
// Recovering from Level 3
// ---------------------------------------------------------------------------------------

#[test]
fn recipient_can_recover_funds_stranded_at_level_3() {
    let rig = Rig::new();
    rig.arm();
    rig.execute_naming(1); // nothing registered, so this lands at Level 3
    assert_eq!(rig.client().unresolved_by_recipient(&rig.recipient), MINTED);

    rig.env.mock_all_auths(); // stands in for the recipient's signature
    rig.client()
        .claim_unresolved(&rig.recipient, &rig.recipient);

    assert_eq!(rig.balance(&rig.recipient), MINTED, "the funds must actually arrive");
    assert_eq!(rig.client().unresolved_by_recipient(&rig.recipient), 0);
    assert_eq!(rig.balance(&rig.core), 0, "nothing left stranded");
}

#[test]
fn recovery_can_be_redirected_to_a_provisioned_address() {
    let rig = Rig::new();
    let provisioned = Address::generate(&rig.env);
    rig.arm();
    rig.execute_naming(1);

    rig.env.mock_all_auths();
    rig.client().claim_unresolved(&rig.recipient, &provisioned);

    assert_eq!(rig.balance(&provisioned), MINTED);
    assert_eq!(rig.balance(&rig.recipient), 0);
}

#[test]
fn recovery_requires_the_recipients_authorization() {
    let rig = Rig::new();
    let attacker_destination = Address::generate(&rig.env);
    rig.arm();
    rig.execute_naming(1);

    let result = rig
        .client()
        .try_claim_unresolved(&rig.recipient, &attacker_destination);

    assert!(result.is_err(), "stranded funds still belong to the recipient");
    assert_eq!(rig.balance(&attacker_destination), 0);
    assert_eq!(rig.client().unresolved_by_recipient(&rig.recipient), MINTED);
}

#[test]
fn recovery_with_nothing_stranded_is_rejected() {
    let rig = Rig::new();
    rig.arm();
    rig.env.mock_all_auths();

    let result = rig
        .client()
        .try_claim_unresolved(&rig.recipient, &rig.recipient);

    assert!(result.is_err());
}

/// Pins down the known limitation rather than leaving it implicit: when an instruction was too
/// malformed to yield a recipient, the funds are keyed by CCTP nonce and *nobody* can recover
/// them. Recovering them would require an authority to decide who is entitled — the admin key
/// this contract is built not to have. If this test ever starts failing, that trade-off has
/// been changed and needs a deliberate decision.
#[test]
fn nonce_keyed_funds_are_unrecoverable_by_design() {
    let rig = Rig::new();
    rig.arm();

    // Too short to yield a fallback_recipient at all.
    let envelope = std::vec![0x01u8; 10];
    let message = fixtures::message(&rig.env, &rig.core, &envelope);
    rig.client().execute(&message, &Bytes::new(&rig.env));

    assert_eq!(
        rig.client()
            .unresolved_by_nonce(&fixtures::test_nonce(&rig.env)),
        MINTED,
        "the funds are recorded, just not attributable"
    );

    // No recipient was ever recorded, so there is no one for the recovery path to pay.
    rig.env.mock_all_auths();
    let result = rig
        .client()
        .try_claim_unresolved(&rig.recipient, &rig.recipient);
    assert!(result.is_err());
    assert_eq!(rig.balance(&rig.core), MINTED, "and so they stay here");
}

// ---------------------------------------------------------------------------------------
// Authorization is scoped to exactly one pull
// ---------------------------------------------------------------------------------------

/// Tries to take more than the core authorized it for.
#[contract]
pub struct HandlerGreedy;

#[contractimpl]
impl HandlerGreedy {
    pub fn __constructor(env: Env, core: Address, token: Address) {
        env.storage().instance().set(&symbol_short!("CORE"), &core);
        env.storage().instance().set(&symbol_short!("TOK"), &token);
    }

    pub fn execute(env: Env, _recipient: Address, amount: i128, _params: Bytes) {
        pull(&env, amount * 2);
    }
}

#[test]
fn handler_cannot_pull_more_than_it_was_authorized_for() {
    let rig = Rig::new();
    // Extra funds sitting in the core, of the kind a previous Level-3 fallback would leave —
    // a greedy handler must not be able to reach them.
    token::StellarAssetClient::new(&rig.env, &rig.token).mint(&rig.core, &MINTED);

    let greedy = rig.env.register(HandlerGreedy, (&rig.core, &rig.token));
    let hold = rig.handler_ok();
    rig.register(1, &greedy);
    rig.register(HOLD_HANDLER_ID, &hold);
    rig.arm();

    rig.execute_naming(1);

    assert_eq!(
        rig.balance(&greedy),
        0,
        "the authorization covers one exact transfer; anything more must fail"
    );
    // Overreaching is just another handler failure, so the ladder carries on to Hold.
    assert_eq!(rig.balance(&hold), MINTED);
    assert_eq!(rig.balance(&rig.core), MINTED, "the pre-existing funds stay put");
}

// ---------------------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------------------

#[test]
fn constructor_stores_both_immutable_addresses() {
    let rig = Rig::new();

    rig.env.as_contract(&rig.core, || {
        let forwarder: Address = rig.env.storage().instance().get(&FORWARDER).unwrap();
        let token: Address = rig.env.storage().instance().get(&TOKEN).unwrap();
        assert_eq!(forwarder, rig.forwarder);
        assert_eq!(token, rig.token);
    });
}

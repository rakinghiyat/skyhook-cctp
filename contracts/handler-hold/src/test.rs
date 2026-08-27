#![cfg(test)]

use super::*;
use soroban_sdk::auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation};
use soroban_sdk::testutils::{Address as _, Events};
use soroban_sdk::{contract, contractimpl, token, vec, Address, Bytes, Env, Event, IntoVal};

const HELD_AMOUNT: i128 = 10_000_000;

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

    pub fn run(env: Env, handler: Address, recipient: Address, amount: i128) {
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
            (recipient, amount, Bytes::new(&env)).into_val(&env),
        );
    }
}

// ---------------------------------------------------------------------------------------
// Rig
// ---------------------------------------------------------------------------------------

struct Rig {
    env: Env,
    handler: Address,
    core: Address,
    token: Address,
    recipient: Address,
}

impl Rig {
    /// Auth is mocked only while wiring up; every test then calls `arm()` so the real
    /// authorization paths — the core's scoped pull, and the recipient's own signature on
    /// claim — are genuinely exercised.
    fn new() -> Rig {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let token = env.register_stellar_asset_contract_v2(admin).address();
        let core = env.register(MockCore, (&token,));
        token::StellarAssetClient::new(&env, &token).mint(&core, &(HELD_AMOUNT * 4));

        let handler = env.register(HandlerHold, (&core, &token));
        let recipient = Address::generate(&env);

        Rig {
            env,
            handler,
            core,
            token,
            recipient,
        }
    }

    fn arm(&self) {
        self.env.set_auths(&[]);
    }

    fn client(&self) -> HandlerHoldClient<'_> {
        HandlerHoldClient::new(&self.env, &self.handler)
    }

    fn deliver_to(&self, recipient: &Address, amount: i128) {
        MockCoreClient::new(&self.env, &self.core).run(&self.handler, recipient, &amount);
    }

    fn deliver(&self) {
        self.deliver_to(&self.recipient.clone(), HELD_AMOUNT);
    }

    fn balance(&self, who: &Address) -> i128 {
        token::TokenClient::new(&self.env, &self.token).balance(who)
    }
}

// ---------------------------------------------------------------------------------------
// Receiving funds from the core
// ---------------------------------------------------------------------------------------

#[test]
fn execute_pulls_the_funds_and_records_them() {
    let rig = Rig::new();
    rig.arm();

    rig.deliver();

    assert_eq!(rig.balance(&rig.handler), HELD_AMOUNT, "funds should have been pulled in");
    assert_eq!(rig.client().held(&rig.recipient), HELD_AMOUNT);
    assert_eq!(
        rig.balance(&rig.handler),
        rig.client().held(&rig.recipient),
        "the ledger balance and what we claim to hold must agree"
    );
}

#[test]
fn repeated_deliveries_accumulate() {
    let rig = Rig::new();
    rig.arm();

    rig.deliver();
    rig.deliver();

    assert_eq!(rig.client().held(&rig.recipient), HELD_AMOUNT * 2);
    assert_eq!(rig.balance(&rig.handler), HELD_AMOUNT * 2);
}

#[test]
fn execute_from_an_unauthorized_caller_records_nothing() {
    let rig = Rig::new();
    // A second "core" the handler was never constructed against, funded and willing to try.
    let impostor = rig.env.register(MockCore, (&rig.token,));
    token::StellarAssetClient::new(&rig.env, &rig.token).mint(&impostor, &HELD_AMOUNT);
    rig.arm();

    let result = MockCoreClient::new(&rig.env, &impostor).try_run(
        &rig.handler,
        &rig.recipient,
        &HELD_AMOUNT,
    );

    assert!(result.is_err(), "only the core it was built for can deliver funds");
    assert_eq!(rig.client().held(&rig.recipient), 0);
    assert_eq!(rig.balance(&rig.handler), 0);
}

// ---------------------------------------------------------------------------------------
// Claiming
// ---------------------------------------------------------------------------------------

#[test]
fn claim_pays_the_recipient_in_full() {
    let rig = Rig::new();
    rig.arm();
    rig.deliver();

    rig.env.mock_all_auths(); // stands in for the recipient's signature
    rig.client().claim(&rig.recipient);

    // Read the events before anything else: `events().all()` only reports the most recent
    // invocation, and every balance check below is itself an invocation.
    let expected = Claimed {
        recipient: rig.recipient.clone(),
        to: rig.recipient.clone(),
        amount: HELD_AMOUNT,
    }
    .to_xdr(&rig.env, &rig.handler);
    assert!(
        rig.env.events().all().events().contains(&expected),
        "a claim must be traceable to the recipient, destination and amount"
    );

    assert_eq!(rig.balance(&rig.recipient), HELD_AMOUNT);
    assert_eq!(rig.client().held(&rig.recipient), 0, "the entry must be cleared");
    assert_eq!(rig.balance(&rig.handler), 0);
}

#[test]
fn claim_without_the_recipients_authorization_fails() {
    let rig = Rig::new();
    rig.arm();
    rig.deliver();

    // No auth supplied — nobody signed for the recipient.
    let result = rig.client().try_claim(&rig.recipient);

    assert!(result.is_err(), "funds must not move without the recipient's say-so");
    assert_eq!(rig.client().held(&rig.recipient), HELD_AMOUNT, "balance intact");
}

#[test]
fn one_recipient_cannot_claim_anothers_funds() {
    let rig = Rig::new();
    let other = Address::generate(&rig.env);
    rig.arm();
    rig.deliver();

    rig.env.mock_all_auths();
    let result = rig.client().try_claim(&other);

    assert!(result.is_err(), "there is nothing held for this address");
    assert_eq!(
        rig.client().held(&rig.recipient),
        HELD_AMOUNT,
        "the real recipient's balance is untouched"
    );
}

#[test]
fn claiming_with_nothing_held_is_rejected() {
    let rig = Rig::new();
    rig.arm();
    rig.env.mock_all_auths();

    let result = rig.client().try_claim(&rig.recipient);

    assert!(
        result.is_err(),
        "an empty claim must fail loudly rather than succeed silently"
    );
}

#[test]
fn claim_to_pays_the_nominated_address() {
    let rig = Rig::new();
    let provisioned = Address::generate(&rig.env);
    rig.arm();
    rig.deliver();

    rig.env.mock_all_auths();
    rig.client().claim_to(&rig.recipient, &provisioned);

    assert_eq!(rig.balance(&provisioned), HELD_AMOUNT);
    assert_eq!(rig.balance(&rig.recipient), 0, "the recipient itself receives nothing");
    assert_eq!(rig.client().held(&rig.recipient), 0);
}

#[test]
fn claim_to_still_requires_the_recipients_authorization() {
    let rig = Rig::new();
    let attacker_destination = Address::generate(&rig.env);
    rig.arm();
    rig.deliver();

    // Anyone could name a destination; only the recipient can authorize the move.
    let result = rig
        .client()
        .try_claim_to(&rig.recipient, &attacker_destination);

    assert!(result.is_err());
    assert_eq!(rig.balance(&attacker_destination), 0);
    assert_eq!(rig.client().held(&rig.recipient), HELD_AMOUNT);
}

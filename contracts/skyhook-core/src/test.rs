#![cfg(test)]

use super::*;
use soroban_sdk::testutils::Address as _;

// Gate-probe scope only: confirms the immutable forwarder address is stored correctly at
// construction. Cross-contract mint_and_forward behavior against the real CctpForwarder is
// exercised on Testnet (docs/EVIDENCE.md §2), not here — there is no local mock of Circle's
// contract to test against.
#[test]
fn constructor_stores_forwarder() {
    let env = Env::default();
    let forwarder = Address::generate(&env);
    let contract_id = env.register(SkyhookCore, (&forwarder,));

    env.as_contract(&contract_id, || {
        let stored: Address = env.storage().instance().get(&FORWARDER).unwrap();
        assert_eq!(stored, forwarder);
    });
}

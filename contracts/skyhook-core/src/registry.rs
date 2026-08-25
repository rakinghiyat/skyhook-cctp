// Permissionless, append-only handler registry: handler_id (u32) -> handler contract address.
// Anyone may register a new id; nobody may rebind an id that's already bound
// (docs/ARCHITECTURE.md §3) — that's what makes an id safe for a sender to encode.
use soroban_sdk::{Address, Env};

use crate::storage::DataKey;

// TTL is bumped on write, not on read. A resolve() miss (expired or never-registered) is
// safely absorbed by the fallback ladder (ARCHITECTURE.md §4), so this is an availability
// choice, not a fund-safety one.
use crate::storage::{TTL_EXTEND_TO_LEDGERS, TTL_THRESHOLD_LEDGERS};

/// Registers `contract` under `id`. Panics if `id` is already bound.
pub fn register_handler(env: &Env, id: u32, contract: Address) {
    let key = DataKey::Handler(id);
    if env.storage().persistent().has(&key) {
        panic!("handler id already registered");
    }
    env.storage().persistent().set(&key, &contract);
    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_THRESHOLD_LEDGERS, TTL_EXTEND_TO_LEDGERS);
}

/// Resolves `id` to its registered handler address, if any.
pub fn resolve(env: &Env, id: u32) -> Option<Address> {
    env.storage().persistent().get(&DataKey::Handler(id))
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    #[test]
    fn register_once_succeeds_and_resolves() {
        let env = Env::default();
        let handler = Address::generate(&env);
        env.as_contract(&env.register(TestContract, ()), || {
            register_handler(&env, 1, handler.clone());
            assert_eq!(resolve(&env, 1), Some(handler));
        });
    }

    #[test]
    #[should_panic(expected = "handler id already registered")]
    fn reregistering_same_id_panics() {
        let env = Env::default();
        let handler_a = Address::generate(&env);
        let handler_b = Address::generate(&env);
        env.as_contract(&env.register(TestContract, ()), || {
            register_handler(&env, 1, handler_a);
            register_handler(&env, 1, handler_b);
        });
    }

    #[test]
    fn registering_second_distinct_id_succeeds() {
        let env = Env::default();
        let handler_a = Address::generate(&env);
        let handler_b = Address::generate(&env);
        env.as_contract(&env.register(TestContract, ()), || {
            register_handler(&env, 1, handler_a.clone());
            register_handler(&env, 2, handler_b.clone());
            assert_eq!(resolve(&env, 1), Some(handler_a));
            assert_eq!(resolve(&env, 2), Some(handler_b));
        });
    }

    #[test]
    fn resolve_of_unregistered_id_is_none() {
        let env = Env::default();
        env.as_contract(&env.register(TestContract, ()), || {
            assert_eq!(resolve(&env, 42), None);
        });
    }

    // A bare contract with no storage of its own, just so these tests have a contract
    // context to run persistent-storage calls inside of.
    #[soroban_sdk::contract]
    struct TestContract;
    #[soroban_sdk::contractimpl]
    impl TestContract {
        pub fn __constructor(_env: Env) {}
    }
}

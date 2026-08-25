// Permissionless, append-only handler registry: handler_id (u32) -> handler contract address.
// Anyone may register a new id; nobody may rebind an id that's already bound
// (docs/ARCHITECTURE.md §3) — that's what makes an id safe for a sender to encode.
//
// `resolve` isn't called from `execute()` yet — wiring it into the fallback ladder is the
// next task. `#[allow(dead_code)]` is temporary until that call site exists.
#![allow(dead_code)]
use soroban_sdk::{Address, Env};

// ~30 days of margin before the entry would expire, bumped to ~90 days on every write.
// A resolve() miss (expired or never-registered) is safely absorbed by the fallback ladder
// (ARCHITECTURE.md §4), so this is an availability choice, not a fund-safety one.
const TTL_THRESHOLD_LEDGERS: u32 = 30 * 17280;
const TTL_EXTEND_TO_LEDGERS: u32 = 90 * 17280;

/// Registers `contract` under `id`. Panics if `id` is already bound.
pub fn register_handler(env: &Env, id: u32, contract: Address) {
    if env.storage().persistent().has(&id) {
        panic!("handler id already registered");
    }
    env.storage().persistent().set(&id, &contract);
    env.storage()
        .persistent()
        .extend_ttl(&id, TTL_THRESHOLD_LEDGERS, TTL_EXTEND_TO_LEDGERS);
}

/// Resolves `id` to its registered handler address, if any.
pub fn resolve(env: &Env, id: u32) -> Option<Address> {
    env.storage().persistent().get(&id)
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

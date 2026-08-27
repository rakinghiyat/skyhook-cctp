use soroban_sdk::{contracttype, Address};

// Mirrors skyhook-core's policy: ~30 days of margin before an entry would expire, bumped to
// ~90 days on every write. Held funds are a user's money, so the entry is refreshed whenever
// it changes.
pub const TTL_THRESHOLD_LEDGERS: u32 = 30 * 17280;
pub const TTL_EXTEND_TO_LEDGERS: u32 = 90 * 17280;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Funds held for an address until it claims them.
    Held(Address),
}

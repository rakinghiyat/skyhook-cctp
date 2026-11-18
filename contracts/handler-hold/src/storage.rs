use soroban_sdk::{contracttype, Address};

// Same policy as skyhook-core: extend to ~90 days on every write once fewer than ~30 remain.
pub const TTL_THRESHOLD_LEDGERS: u32 = 30 * 17280;
pub const TTL_EXTEND_TO_LEDGERS: u32 = 90 * 17280;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Funds held for an address until it claims them.
    Held(Address),
}

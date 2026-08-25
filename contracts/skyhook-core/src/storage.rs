// Persistent-storage keys. Registry entries and unresolved balances share the same keyspace,
// so they're distinguished explicitly here rather than relying on their raw value types
// happening not to collide.
use soroban_sdk::{contracttype, Address, BytesN};

// ~30 days of margin before an entry would expire, bumped to ~90 days on every write.
pub const TTL_THRESHOLD_LEDGERS: u32 = 30 * 17280;
pub const TTL_EXTEND_TO_LEDGERS: u32 = 90 * 17280;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// handler_id -> handler contract address (append-only, see registry.rs)
    Handler(u32),
    /// Funds the ladder could not deliver, keyed by the recipient recovered from the
    /// instruction (ARCHITECTURE.md §4, Level 3).
    UnresolvedByRecipient(Address),
    /// Same, but for the case where no recipient could be recovered at all — keyed by the
    /// CCTP nonce, which is readable straight from the outer message regardless of how
    /// corrupt the instruction was.
    UnresolvedByNonce(BytesN<32>),
}

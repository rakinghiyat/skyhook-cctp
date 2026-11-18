// Storage keys. Registry entries and unresolved balances share one keyspace, so each kind
// gets its own variant to keep them from colliding.
use soroban_sdk::{contracttype, Address, BytesN};

// ~30 days of margin before an entry would expire, bumped to ~90 days on every write.
pub const TTL_THRESHOLD_LEDGERS: u32 = 30 * 17280;
pub const TTL_EXTEND_TO_LEDGERS: u32 = 90 * 17280;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// handler_id -> handler contract address (append-only, see registry.rs)
    Handler(u32),
    /// Undelivered funds, keyed by the recipient read from the instruction.
    UnresolvedByRecipient(Address),
    /// Undelivered funds when no recipient could be read, keyed by the CCTP nonce instead.
    UnresolvedByNonce(BytesN<32>),
}

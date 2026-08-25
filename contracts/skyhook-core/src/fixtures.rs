#![cfg(test)]
// Shared builders for realistic CCTP messages, used by both the parser's own unit tests and
// the contract-level ladder tests. Sizes and offsets mirror the verified layout documented in
// parse.rs.
use soroban_sdk::{Address, Bytes, BytesN, Env};
use std::string::ToString;
use std::vec::Vec;

pub const OUTER_HEADER_LEN: usize = 148;
pub const BODY_FIXED_LEN: usize = 228;
const NONCE_OFFSET: usize = 12;

/// A distinctive nonce written into every fixture message, so tests can assert that Level-3
/// fallback keyed the funds against the right one.
pub const TEST_NONCE: [u8; 32] = [0xAB; 32];

pub fn test_nonce(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &TEST_NONCE)
}

/// A well-formed Skyhook instruction envelope (SPEC.md §2).
pub fn envelope(fallback_recipient: &Address, handler_id: u32, params: &[u8]) -> Vec<u8> {
    let mut e = std::vec![0x01u8]; // version
    e.extend_from_slice(fallback_recipient.to_string().to_string().as_bytes());
    e.extend_from_slice(&handler_id.to_be_bytes());
    e.extend_from_slice(&(params.len() as u16).to_be_bytes());
    e.extend_from_slice(params);
    e
}

/// Circle's hook frame (magic / version / L / forwardRecipient) wrapped around `trailing`.
pub fn hook_frame(forward_recipient: &Address, trailing: &[u8]) -> Vec<u8> {
    let recipient = forward_recipient.to_string().to_string();
    let bytes = recipient.as_bytes();
    let mut hook = std::vec![0u8; 24]; // magic
    hook.extend_from_slice(&0u32.to_be_bytes()); // hook version
    hook.extend_from_slice(&(bytes.len() as u32).to_be_bytes()); // L
    hook.extend_from_slice(bytes);
    hook.extend_from_slice(trailing);
    hook
}

/// A full raw CCTP message carrying `hook` as its hookData. The outer header and messageBody
/// fixed fields are zeroed apart from the nonce — nothing else in them is read.
pub fn message_with_hook(env: &Env, hook: &[u8]) -> Bytes {
    let mut msg = std::vec![0u8; OUTER_HEADER_LEN + BODY_FIXED_LEN];
    msg[NONCE_OFFSET..NONCE_OFFSET + 32].copy_from_slice(&TEST_NONCE);
    msg.extend_from_slice(hook);
    Bytes::from_slice(env, &msg)
}

/// The common case: a full message whose hookData names `forward_recipient` and carries
/// `envelope_bytes` as the Skyhook instruction.
pub fn message(env: &Env, forward_recipient: &Address, envelope_bytes: &[u8]) -> Bytes {
    message_with_hook(env, &hook_frame(forward_recipient, envelope_bytes))
}

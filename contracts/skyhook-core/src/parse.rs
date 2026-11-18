// Reads the Skyhook instruction from a raw CCTP message. Never panics: every failure returns
// `Parsed::Malformed`, so the caller can fall back to Hold instead of reverting.
//
// The byte offsets were checked field by field against two real Testnet burns.
#![allow(dead_code)]
use soroban_sdk::{Address, Bytes, BytesN, Env};

// --- CCTP v2 outer message (Circle's frame) ---
const OUTER_HEADER_LEN: u32 = 148; // version..finalityThresholdExecuted, all fixed-width
const NONCE_OFFSET: u32 = 12;
const NONCE_LEN: u32 = 32;
const BODY_FIXED_LEN: u32 = 228; // messageBody's version..expirationBlock, fixed-width
// hookData = message[OUTER_HEADER_LEN + BODY_FIXED_LEN ..], derived, never hardcoded as 376.
const HOOK_DATA_OFFSET: u32 = OUTER_HEADER_LEN + BODY_FIXED_LEN;

// --- Circle's hook-data frame (docs/SPEC.md §1) ---
const HOOK_MAGIC_LEN: u32 = 24;
const HOOK_VERSION_LEN: u32 = 4;
const HOOK_L_LEN: u32 = 4;
const HOOK_FRAME_FIXED_LEN: u32 = HOOK_MAGIC_LEN + HOOK_VERSION_LEN + HOOK_L_LEN; // 32

// --- Skyhook's own instruction envelope (docs/SPEC.md §2, revised) ---
const ENV_VERSION_LEN: u32 = 1;
const ENV_RECIPIENT_STRKEY_LEN: u32 = 56; // a Stellar strkey (G or C) is always 56 ASCII bytes
const ENV_HANDLER_ID_LEN: u32 = 4;
const ENV_PARAMS_LEN_LEN: u32 = 2;
const ENV_RECIPIENT_HEADER_LEN: u32 = ENV_VERSION_LEN + ENV_RECIPIENT_STRKEY_LEN; // 57
const ENV_FULL_HEADER_LEN: u32 = ENV_RECIPIENT_HEADER_LEN + ENV_HANDLER_ID_LEN + ENV_PARAMS_LEN_LEN; // 63
const ENV_VERSION: u8 = 0x01;

/// A successfully parsed Skyhook instruction.
#[derive(Debug, PartialEq, Eq)]
pub struct Instruction {
    pub fallback_recipient: Address,
    pub handler_id: u32,
    pub params: Bytes,
}

/// Result of parsing. `Malformed` keeps the recipient if one could be read. It is `None` when
/// the message is too short to reach that field or the bytes aren't a valid strkey. The caller
/// uses this to pick Hold (has a recipient) or the nonce record (has none).
#[derive(Debug, PartialEq, Eq)]
pub enum Parsed {
    Instruction(Instruction),
    Malformed { fallback_recipient: Option<Address> },
}

/// Top-level entry point: raw CCTP `message` -> `Parsed`. Never panics.
pub fn parse(_env: &Env, message: &Bytes) -> Parsed {
    match extract_hook_data(message).and_then(|hd| locate_instruction(&hd)) {
        Some(envelope) => parse_envelope(&envelope),
        None => Parsed::Malformed { fallback_recipient: None },
    }
}

/// The CCTP nonce from the outer header. It can be read however broken the instruction is,
/// so it works as the last-resort key for unresolved funds.
pub fn nonce(message: &Bytes) -> Option<BytesN<32>> {
    if message.len() < NONCE_OFFSET + NONCE_LEN {
        return None;
    }
    message
        .slice(NONCE_OFFSET..NONCE_OFFSET + NONCE_LEN)
        .try_into()
        .ok()
}

/// message -> hookData, bounds-checked against the fixed CCTP frame length.
fn extract_hook_data(message: &Bytes) -> Option<Bytes> {
    if message.len() < HOOK_DATA_OFFSET {
        return None;
    }
    Some(message.slice(HOOK_DATA_OFFSET..message.len()))
}

/// hookData -> the Skyhook envelope (hookData[32+L..]). Checks Circle's magic, version and L
/// again instead of trusting them, since a future message might not follow the format.
fn locate_instruction(hook_data: &Bytes) -> Option<Bytes> {
    if hook_data.len() < HOOK_FRAME_FIXED_LEN {
        return None;
    }
    for i in 0..HOOK_MAGIC_LEN {
        if hook_data.get(i)? != 0 {
            return None;
        }
    }
    let version = read_u32_be(hook_data, HOOK_MAGIC_LEN)?;
    if version != 0 {
        return None;
    }
    let l = read_u32_be(hook_data, HOOK_MAGIC_LEN + HOOK_VERSION_LEN)?;
    let instruction_start = HOOK_FRAME_FIXED_LEN.checked_add(l)?;
    if instruction_start > hook_data.len() {
        return None;
    }
    Some(hook_data.slice(instruction_start..hook_data.len()))
}

/// Skyhook envelope -> Parsed. The recipient always sits in the first 57 bytes, whatever the
/// version, so we can recover it even when the version is unknown or the rest is garbage.
fn parse_envelope(envelope: &Bytes) -> Parsed {
    if envelope.len() < ENV_RECIPIENT_HEADER_LEN {
        return Parsed::Malformed { fallback_recipient: None };
    }
    let strkey_bytes = envelope.slice(ENV_VERSION_LEN..ENV_RECIPIENT_HEADER_LEN);
    let fallback_recipient = match address_from_strkey_bytes(&strkey_bytes) {
        Some(addr) => addr,
        None => return Parsed::Malformed { fallback_recipient: None },
    };

    let version = envelope.get_unchecked(0);
    if version != ENV_VERSION || envelope.len() < ENV_FULL_HEADER_LEN {
        return Parsed::Malformed {
            fallback_recipient: Some(fallback_recipient),
        };
    }
    let handler_id = match read_u32_be(envelope, ENV_RECIPIENT_HEADER_LEN) {
        Some(v) => v,
        None => {
            return Parsed::Malformed {
                fallback_recipient: Some(fallback_recipient),
            }
        }
    };
    let params_len = match read_u16_be(envelope, ENV_RECIPIENT_HEADER_LEN + ENV_HANDLER_ID_LEN) {
        Some(v) => v as u32,
        None => {
            return Parsed::Malformed {
                fallback_recipient: Some(fallback_recipient),
            }
        }
    };
    let params_end = match ENV_FULL_HEADER_LEN.checked_add(params_len) {
        Some(end) if end <= envelope.len() => end,
        _ => {
            return Parsed::Malformed {
                fallback_recipient: Some(fallback_recipient),
            }
        }
    };
    Parsed::Instruction(Instruction {
        fallback_recipient,
        handler_id,
        params: envelope.slice(ENV_FULL_HEADER_LEN..params_end),
    })
}

/// Checks the 56 bytes are a valid G or C strkey before calling `Address::from_string_bytes`,
/// which panics on anything invalid.
fn address_from_strkey_bytes(strkey: &Bytes) -> Option<Address> {
    if strkey.len() != ENV_RECIPIENT_STRKEY_LEN {
        return None;
    }
    let mut buf = [0u8; ENV_RECIPIENT_STRKEY_LEN as usize];
    strkey.copy_into_slice(&mut buf);
    let s = core::str::from_utf8(&buf).ok()?;
    let is_valid = stellar_strkey::Contract::from_string(s).is_ok()
        || stellar_strkey::ed25519::PublicKey::from_string(s).is_ok();
    if !is_valid {
        return None;
    }
    Some(Address::from_string_bytes(strkey))
}

fn read_u32_be(b: &Bytes, at: u32) -> Option<u32> {
    if b.len() < at + 4 {
        return None;
    }
    let mut buf = [0u8; 4];
    b.slice(at..at + 4).copy_into_slice(&mut buf);
    Some(u32::from_be_bytes(buf))
}

fn read_u16_be(b: &Bytes, at: u32) -> Option<u16> {
    if b.len() < at + 2 {
        return None;
    }
    let mut buf = [0u8; 2];
    b.slice(at..at + 2).copy_into_slice(&mut buf);
    Some(u16::from_be_bytes(buf))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fixtures::{
        envelope as well_formed_envelope, hook_frame, message as build_message, message_with_hook,
    };
    use soroban_sdk::testutils::Address as _;

    #[test]
    fn parses_well_formed_instruction() {
        let env = Env::default();
        let forwarder = Address::generate(&env);
        let recipient = Address::generate(&env);
        let params = [1u8, 2, 3, 4];
        let envelope = well_formed_envelope(&recipient, 1, &params);
        let msg = build_message(&env, &forwarder, &envelope);

        match parse(&env, &msg) {
            Parsed::Instruction(ix) => {
                assert_eq!(ix.fallback_recipient, recipient);
                assert_eq!(ix.handler_id, 1);
                assert_eq!(ix.params, Bytes::from_slice(&env, &params));
            }
            other => panic!("expected Instruction, got {:?}", other),
        }
    }

    #[test]
    fn envelope_shorter_than_57_bytes_yields_no_recipient() {
        let env = Env::default();
        let forwarder = Address::generate(&env);
        // 10 bytes total: nowhere near enough for version(1) + strkey(56)
        let envelope = std::vec![ENV_VERSION; 10];
        let msg = build_message(&env, &forwarder, &envelope);

        assert_eq!(
            parse(&env, &msg),
            Parsed::Malformed { fallback_recipient: None }
        );
    }

    #[test]
    fn params_len_inconsistent_with_remaining_bytes() {
        let env = Env::default();
        let forwarder = Address::generate(&env);
        let recipient = Address::generate(&env);
        let mut envelope = well_formed_envelope(&recipient, 1, &[]);
        // Claim 100 bytes of params that don't exist.
        let claim_at = (ENV_RECIPIENT_HEADER_LEN + ENV_HANDLER_ID_LEN) as usize;
        envelope[claim_at..claim_at + 2].copy_from_slice(&100u16.to_be_bytes());
        let msg = build_message(&env, &forwarder, &envelope);

        assert_eq!(
            parse(&env, &msg),
            Parsed::Malformed {
                fallback_recipient: Some(recipient)
            }
        );
    }

    #[test]
    fn unrecognized_version_still_recovers_recipient() {
        let env = Env::default();
        let forwarder = Address::generate(&env);
        let recipient = Address::generate(&env);
        let mut envelope = well_formed_envelope(&recipient, 1, &[]);
        envelope[0] = 0x99; // unrecognized version
        let msg = build_message(&env, &forwarder, &envelope);

        assert_eq!(
            parse(&env, &msg),
            Parsed::Malformed {
                fallback_recipient: Some(recipient)
            }
        );
    }

    #[test]
    fn hook_data_offset_math_is_correct() {
        let env = Env::default();
        let forwarder = Address::generate(&env);
        let recipient = Address::generate(&env);
        let envelope = well_formed_envelope(&recipient, 2, &[9, 9]);
        let msg = build_message(&env, &forwarder, &envelope);

        // hookData must start exactly at OUTER_HEADER_LEN + BODY_FIXED_LEN.
        let hd = extract_hook_data(&msg).expect("hookData should be present");
        let expected_len = msg.len() - HOOK_DATA_OFFSET;
        assert_eq!(hd.len(), expected_len);
    }

    #[test]
    fn malformed_hook_frame_yields_no_recipient() {
        let env = Env::default();
        let forwarder = Address::generate(&env);
        let recipient = Address::generate(&env);
        let envelope = well_formed_envelope(&recipient, 1, &[]);
        let mut hook = hook_frame(&forwarder, &envelope);
        hook[0] = 1; // corrupt the magic: it must be all zero
        let msg = message_with_hook(&env, &hook);

        assert_eq!(
            parse(&env, &msg),
            Parsed::Malformed { fallback_recipient: None }
        );
    }

    fn hex_decode(s: &str) -> std::vec::Vec<u8> {
        (0..s.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
            .collect()
    }

    /// A real CCTP message from a Testnet burn, not a fixture. Its payload is ASCII test text,
    /// not a Skyhook envelope, so this only checks hookData extraction. Malformed is expected.
    #[test]
    fn hook_data_extraction_matches_real_testnet_message() {
        let env = Env::default();
        let msg_hex = "000000010000001a0000001b317c85b006bcd4a94493dbb656cb857f0a55fe96f594d916aae320b09c29196c0000000000000000000000008fe6b999dc680ccfdd5bf7eb0974218be2542daada6f9ee0786c812344d82817ef19b648b4af120f8bd10bf658e6b99eacff24b83de86ac50b47eaf2840fe23e48179551660fd1072fba6f445d4a6bd7af4ab93e000003e8000007d00000000100000000000000000000000036000000000000000000000000000000000000003de86ac50b47eaf2840fe23e48179551660fd1072fba6f445d4a6bd7af4ab93e00000000000000000000000000000000000000000000000000000000000f424000000000000000000000000088a1968f7c055388454b39cabb1c30207ee1e88500000000000000000000000000000000000000000000000000000000000001f400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003843445353564133453736364141534d4932355458354a474c3254433351534d414c5143575650593443564e4f4b45475737494f5146374632534b59484f4f4b2d474154452d544553542d51332d5041594c4f41442d494e544143542d434845434b";
        let expected_hookdata_hex = "000000000000000000000000000000000000000000000000000000000000003843445353564133453736364141534d4932355458354a474c3254433351534d414c5143575650593443564e4f4b45475737494f5146374632534b59484f4f4b2d474154452d544553542d51332d5041594c4f41442d494e544143542d434845434b";

        let msg = Bytes::from_slice(&env, &hex_decode(msg_hex));
        let hd = extract_hook_data(&msg).expect("hookData should be present in a real message");
        let expected = Bytes::from_slice(&env, &hex_decode(expected_hookdata_hex));
        assert_eq!(hd, expected, "extracted hookData must match what Circle's own API returned during the gate");

        // The test payload isn't a Skyhook envelope, so Malformed is right.
        assert_eq!(
            parse(&env, &msg),
            Parsed::Malformed { fallback_recipient: None }
        );
    }
}

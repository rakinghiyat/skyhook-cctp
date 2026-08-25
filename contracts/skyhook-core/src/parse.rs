// Parses the Skyhook instruction out of a raw CCTP message. Never panics — every failure
// path returns `Parsed::Malformed` so a caller can route to the Hold handler instead of
// aborting the whole invocation (docs/ARCHITECTURE.md §4).
//
// Byte offsets below are not guesses: they were reconstructed and verified field-by-field
// against two real burn+attestation cycles run on Testnet (raw message hex cross-checked
// against Circle's own decoded fields, byte range by byte range).
//
// Not yet called from `execute()` (see lib.rs) — wiring it into the fallback ladder is the
// next task. Fully built and tested here; `#[allow(dead_code)]` is temporary until that call
// site exists.
#![allow(dead_code)]
use soroban_sdk::{Address, Bytes, Env};

// --- CCTP v2 outer message (Circle's frame) ---
const OUTER_HEADER_LEN: u32 = 148; // version..finalityThresholdExecuted, all fixed-width
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

/// Outcome of parsing. `Malformed` carries whatever `fallback_recipient` could be recovered —
/// `None` only when the message was too short/corrupt to even reach the recipient field, or
/// when those bytes aren't a valid strkey. This is what lets a future caller choose between
/// ARCHITECTURE.md §4's Level-2 (recipient-keyed) and Level-3 (nonce-keyed) fallback without
/// re-parsing.
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

/// message -> hookData, bounds-checked against the fixed CCTP frame length.
fn extract_hook_data(message: &Bytes) -> Option<Bytes> {
    if message.len() < HOOK_DATA_OFFSET {
        return None;
    }
    Some(message.slice(HOOK_DATA_OFFSET..message.len()))
}

/// hookData -> the Skyhook envelope bytes (hookData[32+L..]). Defensively re-validates
/// Circle's magic/version/L rather than trusting it — that trust doesn't extend to an
/// arbitrary future message.
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

/// Skyhook envelope bytes -> Parsed. `fallback_recipient` sits at a version-independent fixed
/// prefix (offsets 0..57) by design, so it's recovered whenever the envelope reaches 57 bytes
/// and those bytes decode as a valid strkey — even if `version` itself is unrecognized or
/// everything after is garbage.
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

/// Validates `strkey` (must be exactly 56 bytes) as a real Stellar strkey (account or
/// contract) via `stellar-strkey`'s panic-free `Result` API before ever calling
/// `Address::from_string_bytes`, which panics on anything that isn't a valid strkey.
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
    use soroban_sdk::testutils::Address as _;
    use std::string::ToString;

    /// Builds a realistic raw CCTP message: dummy (but correctly-sized) outer header and
    /// messageBody fixed fields, real Circle hook-frame, and the given Skyhook envelope bytes
    /// appended after `forwardRecipient`.
    fn build_message(env: &Env, forward_recipient: &Address, envelope: &[u8]) -> Bytes {
        let mut msg = std::vec![0u8; OUTER_HEADER_LEN as usize + BODY_FIXED_LEN as usize];
        // header/messageBody fixed fields are irrelevant to parse.rs — left zeroed.

        let recipient_str = forward_recipient.to_string();
        let recipient_bytes = strkey_ascii(env, &recipient_str.to_string());
        let l = recipient_bytes.len() as u32;

        let mut hook = std::vec![0u8; 24]; // magic
        hook.extend_from_slice(&0u32.to_be_bytes()); // hook version
        hook.extend_from_slice(&l.to_be_bytes()); // L
        hook.extend_from_slice(&recipient_bytes);
        hook.extend_from_slice(envelope);

        msg.extend_from_slice(&hook);
        Bytes::from_slice(env, &msg)
    }

    // soroban_sdk::String doesn't expose a std String directly in no_std builds used by the
    // contract, but tests run under std — this helper bridges that for fixture-building only.
    fn strkey_ascii(_env: &Env, s: &std::string::String) -> std::vec::Vec<u8> {
        s.as_bytes().to_vec()
    }

    fn well_formed_envelope(fallback_recipient: &Address, handler_id: u32, params: &[u8]) -> std::vec::Vec<u8> {
        let mut e = std::vec![ENV_VERSION];
        e.extend_from_slice(fallback_recipient.to_string().to_string().as_bytes());
        e.extend_from_slice(&handler_id.to_be_bytes());
        e.extend_from_slice(&(params.len() as u16).to_be_bytes());
        e.extend_from_slice(params);
        e
    }

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
        let mut msg_vec = std::vec![0u8; OUTER_HEADER_LEN as usize + BODY_FIXED_LEN as usize];
        // Corrupt magic: first byte non-zero.
        let mut hook = std::vec![1u8; 24];
        hook.extend_from_slice(&0u32.to_be_bytes());
        hook.extend_from_slice(&56u32.to_be_bytes());
        hook.extend_from_slice(forwarder.to_string().to_string().as_bytes());
        hook.extend_from_slice(&envelope);
        msg_vec.extend_from_slice(&hook);
        let msg = Bytes::from_slice(&env, &msg_vec);

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

    /// Real raw CCTP message captured from an actual Testnet burn+attestation cycle
    /// (packages/sdk/scripts/.gate-attestation-2-result.json), not a synthetic fixture. Its
    /// hookData trailing bytes are plain ASCII test text from the gate work, not a real
    /// Skyhook envelope, so this only exercises header/hookData extraction against real wire
    /// bytes — it correctly comes back Malformed once envelope parsing takes over.
    #[test]
    fn hook_data_extraction_matches_real_testnet_message() {
        let env = Env::default();
        let msg_hex = "000000010000001a0000001b317c85b006bcd4a94493dbb656cb857f0a55fe96f594d916aae320b09c29196c0000000000000000000000008fe6b999dc680ccfdd5bf7eb0974218be2542daada6f9ee0786c812344d82817ef19b648b4af120f8bd10bf658e6b99eacff24b83de86ac50b47eaf2840fe23e48179551660fd1072fba6f445d4a6bd7af4ab93e000003e8000007d00000000100000000000000000000000036000000000000000000000000000000000000003de86ac50b47eaf2840fe23e48179551660fd1072fba6f445d4a6bd7af4ab93e00000000000000000000000000000000000000000000000000000000000f424000000000000000000000000088a1968f7c055388454b39cabb1c30207ee1e88500000000000000000000000000000000000000000000000000000000000001f400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003843445353564133453736364141534d4932355458354a474c3254433351534d414c5143575650593443564e4f4b45475737494f5146374632534b59484f4f4b2d474154452d544553542d51332d5041594c4f41442d494e544143542d434845434b";
        let expected_hookdata_hex = "000000000000000000000000000000000000000000000000000000000000003843445353564133453736364141534d4932355458354a474c3254433351534d414c5143575650593443564e4f4b45475737494f5146374632534b59484f4f4b2d474154452d544553542d51332d5041594c4f41442d494e544143542d434845434b";

        let msg = Bytes::from_slice(&env, &hex_decode(msg_hex));
        let hd = extract_hook_data(&msg).expect("hookData should be present in a real message");
        let expected = Bytes::from_slice(&env, &hex_decode(expected_hookdata_hex));
        assert_eq!(hd, expected, "extracted hookData must match what Circle's own API returned during the gate");

        // The gate's trailing test payload isn't a real Skyhook envelope — correctly Malformed.
        assert_eq!(
            parse(&env, &msg),
            Parsed::Malformed { fallback_recipient: None }
        );
    }
}

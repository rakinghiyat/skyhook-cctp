// Reads a raw CCTP v2 message.
//
// This exists because Circle's Get Messages endpoint returns **every address field as null** for
// Stellar messages — `recipient`, `destinationCaller` and `mintRecipient` all come back empty,
// because the API cannot tell a 32-byte account from a 32-byte contract. The values are present
// in the raw `message` hex the whole time; they simply have to be read out of it.
//
// The offsets below are the same ones `contracts/skyhook-core/src/parse.rs` uses on-chain,
// reconstructed and verified field by field against real attested messages.
import { StrKey } from "@stellar/stellar-sdk";

const OUTER_HEADER_LEN = 148;
const BODY_FIXED_LEN = 228;

/** Where hookData begins within the outer message. Derived, never hardcoded as 376. */
export const HOOK_DATA_OFFSET = OUTER_HEADER_LEN + BODY_FIXED_LEN;

function u32(buf, at) {
  return buf.readUInt32BE(at);
}

/** CCTP amounts are uint256; USDC values are far inside Number's safe range, but read the low
 *  128 bits as BigInt rather than assuming. */
function u256(buf, at) {
  return BigInt("0x" + buf.subarray(at, at + 32).toString("hex"));
}

function hex(buf, at, len) {
  return "0x" + buf.subarray(at, at + len).toString("hex");
}

/** A 32-byte value that is a Stellar contract, rendered as the `C...` strkey it really is. */
function asContractStrkey(buf, at) {
  try {
    return StrKey.encodeContract(Buffer.from(buf.subarray(at, at + 32)));
  } catch {
    return null;
  }
}

/**
 * Parses a raw CCTP message (hex, with or without `0x`) into the fields it actually contains.
 *
 * Fields the Circle API nulls out are returned here both as raw hex and, where the value is a
 * Stellar contract address, as a strkey.
 */
export function parseCctpMessage(messageHex) {
  const buf = Buffer.from(messageHex.replace(/^0x/, ""), "hex");
  if (buf.length < HOOK_DATA_OFFSET) {
    throw new Error(
      `message is ${buf.length} bytes, shorter than the ${HOOK_DATA_OFFSET}-byte CCTP frame`
    );
  }

  const body = buf.subarray(OUTER_HEADER_LEN);
  const hookData = body.subarray(BODY_FIXED_LEN);

  return {
    version: u32(buf, 0),
    sourceDomain: u32(buf, 4),
    destinationDomain: u32(buf, 8),
    nonce: hex(buf, 12, 32),
    sender: hex(buf, 44, 32),
    // Nulled by the API — recovered here.
    recipient: hex(buf, 76, 32),
    recipientStrkey: asContractStrkey(buf, 76),
    destinationCaller: hex(buf, 108, 32),
    destinationCallerStrkey: asContractStrkey(buf, 108),
    minFinalityThreshold: u32(buf, 140),
    finalityThresholdExecuted: u32(buf, 144),

    body: {
      version: u32(body, 0),
      burnToken: hex(body, 4, 32),
      // Also nulled by the API.
      mintRecipient: hex(body, 36, 32),
      mintRecipientStrkey: asContractStrkey(body, 36),
      amount: u256(body, 68),
      messageSender: hex(body, 100, 32),
      maxFee: u256(body, 132),
      feeExecuted: u256(body, 164),
      expirationBlock: u256(body, 196),
      hookData: "0x" + hookData.toString("hex"),
    },

    hook: parseHookData(hookData),
  };
}

/**
 * Circle's hook frame: 24 magic bytes, a version, the length of `forwardRecipient`, the strkey
 * itself, then whatever the integrator appended — for us, the Skyhook instruction.
 */
export function parseHookData(hookData) {
  if (hookData.length < 32) return null;
  const magicAllZero = hookData.subarray(0, 24).every((b) => b === 0);
  const version = u32(hookData, 24);
  const l = u32(hookData, 28);
  if (!magicAllZero || version !== 0 || 32 + l > hookData.length) return null;

  return {
    version,
    forwardRecipient: hookData.subarray(32, 32 + l).toString("utf8"),
    instruction: "0x" + hookData.subarray(32 + l).toString("hex"),
  };
}

/** True when the message was attested at finalized level and needs no re-attestation. */
export function isFinalized(parsed) {
  return parsed.finalityThresholdExecuted >= 2000;
}

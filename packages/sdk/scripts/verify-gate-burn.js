// Re-derives the exact bytes used in the burn we just sent, and checks field boundaries
// programmatically instead of eyeballing printed hex.
import { StrKey } from "@stellar/stellar-sdk";
import { loadEnv } from "./env.js";
import { buildHookData, toHex } from "../src/hook-data.js";

const env = loadEnv();

const hookData = buildHookData(env.RELAYER_PUBLIC_KEY);
const magic = hookData.slice(0, 24);
const version = new DataView(hookData.buffer).getUint32(24);
const L = new DataView(hookData.buffer).getUint32(28);
const recipientBytes = hookData.slice(32, 32 + L);
const recipientStr = new TextDecoder().decode(recipientBytes);
const trailing = hookData.slice(32 + L);

console.log("hookData total length:", hookData.length, "bytes (expect 32 +", env.RELAYER_PUBLIC_KEY.length, "=", 32 + env.RELAYER_PUBLIC_KEY.length, ")");
console.log("magic all zero:", magic.every((b) => b === 0));
console.log("version:", version, "(expect 0)");
console.log("L:", L, "(expect", env.RELAYER_PUBLIC_KEY.length, ")");
console.log("recipient decodes back to relayer G-address:", recipientStr === env.RELAYER_PUBLIC_KEY, "->", recipientStr);
console.log("trailing payload bytes:", trailing.length, "(expect 0 for baseline test)");

const forwarderRaw = StrKey.decodeContract(env.CCTP_FORWARDER_ID);
console.log("\nforwarder raw bytes length:", forwarderRaw.length, "(expect 32)");
console.log("forwarder bytes32 hex:", toHex(forwarderRaw));
// Round-trip: re-encode raw bytes back to strkey and confirm it matches the original C-address.
const roundTrip = StrKey.encodeContract(forwarderRaw);
console.log("round-trips back to original strkey:", roundTrip === env.CCTP_FORWARDER_ID, "->", roundTrip);

// Gate Q3: does the payload at offset 32+L survive burn -> attestation? Compares Circle's
// returned hookData byte for byte with what gate-burn-2.js built.
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadEnv, repoRoot } from "./env.js";
import { buildHookData, toHex } from "../src/hook-data.js";

const env = loadEnv();
const attestation = JSON.parse(
  readFileSync(path.join(repoRoot, "packages/sdk/scripts/.gate-attestation-2-result.json"), "utf8")
);
const burnInfo = JSON.parse(
  readFileSync(path.join(repoRoot, "packages/sdk/scripts/.gate-burn-2-result.json"), "utf8")
);

const returnedHookData = attestation.decodedMessage.decodedMessageBody.hookData;
const expectedPayload = new TextEncoder().encode(burnInfo.testPayloadUtf8);
const expectedHookData = toHex(buildHookData(env.SKYHOOK_CORE_ID, expectedPayload));

console.log("Expected hookData:", expectedHookData);
console.log("Returned hookData:", returnedHookData);
console.log("Exact match:", expectedHookData.toLowerCase() === returnedHookData.toLowerCase());

// Also read offset 32+L directly, without buildHookData, as a second check.
const raw = Buffer.from(returnedHookData.slice(2), "hex");
const L = raw.readUInt32BE(28);
const recipient = raw.slice(32, 32 + L).toString("utf8");
const trailingPayload = raw.slice(32 + L).toString("utf8");

console.log("\nIndependent re-parse of returned hookData:");
console.log("  forwardRecipient:", recipient, "== SKYHOOK_CORE_ID?", recipient === env.SKYHOOK_CORE_ID);
console.log("  trailing payload:", JSON.stringify(trailingPayload));
console.log("  trailing payload == original?", trailingPayload === burnInfo.testPayloadUtf8);

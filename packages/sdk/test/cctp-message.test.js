import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCctpMessage, isFinalized } from "../src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const captured = path.join(here, "..", "scripts", ".gate-attestation-2-result.json");

// These fixtures are real attested messages captured from Testnet, kept out of git as scratch
// output. Skip rather than fail when they are absent — a fresh clone has none, and the point of
// this test is fidelity to real wire data, which a synthetic fixture could not provide.
const skip = existsSync(captured)
  ? false
  : "no captured attestation available (run a burn first)";

test("recovers the addresses Circle's API returns as null", { skip }, () => {
  const fixture = JSON.parse(readFileSync(captured, "utf8"));
  const api = fixture.decodedMessage;
  const parsed = parseCctpMessage(fixture.message);

  // The precondition for this whole parser existing: the API really does null these out.
  assert.equal(api.recipient, null, "fixture should show the API nulling recipient");
  assert.equal(api.destinationCaller, null);
  assert.equal(api.decodedMessageBody.mintRecipient, null);

  // And the raw hex really does carry them.
  assert.match(parsed.recipient, /^0x[0-9a-f]{64}$/);
  assert.match(parsed.destinationCaller, /^0x[0-9a-f]{64}$/);
  assert.match(parsed.body.mintRecipient, /^0x[0-9a-f]{64}$/);

  // mintRecipient is always the CctpForwarder contract for a Stellar-bound transfer, so it must
  // render as a valid C-address.
  assert.match(parsed.body.mintRecipientStrkey, /^C[A-Z0-9]{55}$/);
});

test("agrees with Circle's own decoding of the fields it does return", { skip }, () => {
  const fixture = JSON.parse(readFileSync(captured, "utf8"));
  const api = fixture.decodedMessage;
  const parsed = parseCctpMessage(fixture.message);

  assert.equal(parsed.sourceDomain, Number(api.sourceDomain));
  assert.equal(parsed.destinationDomain, Number(api.destinationDomain));
  assert.equal(parsed.nonce, api.nonce);
  assert.equal(parsed.minFinalityThreshold, Number(api.minFinalityThreshold));
  assert.equal(parsed.finalityThresholdExecuted, Number(api.finalityThresholdExecuted));
  assert.equal(parsed.body.amount, BigInt(api.decodedMessageBody.amount));
  assert.equal(parsed.body.maxFee, BigInt(api.decodedMessageBody.maxFee));
  assert.equal(parsed.body.hookData, api.decodedMessageBody.hookData);
});

test("reads the Skyhook instruction out of the hook data", { skip }, () => {
  const fixture = JSON.parse(readFileSync(captured, "utf8"));
  const parsed = parseCctpMessage(fixture.message);

  assert.ok(parsed.hook, "hook frame should parse");
  assert.match(parsed.hook.forwardRecipient, /^C[A-Z0-9]{55}$/);
  assert.equal(parsed.hook.version, 0);
});

test("recognises a finalized message", { skip }, () => {
  const fixture = JSON.parse(readFileSync(captured, "utf8"));
  const parsed = parseCctpMessage(fixture.message);
  assert.equal(isFinalized(parsed), parsed.finalityThresholdExecuted >= 2000);
});

test("refuses a message shorter than the CCTP frame", () => {
  assert.throws(() => parseCctpMessage("0x" + "00".repeat(100)), /shorter than/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { buildHookData, parseHookData } from "../src/index.js";

// Circle's own validator is unforgiving about the L field, and these tests pin our side of that
// contract. Verified against circlefin/stellar-cctp: `validate_hook_data` slices exactly
// `32..32+L` and hands those bytes to `MuxedAddress::from_string_bytes`, so an L that does not
// cover the strkey exactly yields either a truncated string or an empty one, and the parse
// fails. Circle's `test_validate_hook_data_rejects_invalid` covers zero-length claims, lengths
// exceeding the data, and a strkey one byte short.
//
// Our builder derives L from the encoded bytes rather than assuming a constant, which is what
// keeps it correct for G, C and M addresses alike. These tests exist so a future refactor cannot
// quietly replace that with a hardcoded 56.

const C_ADDRESS = "CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE";
const G_ADDRESS = "GA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQHES5";
const M_ADDRESS =
  "MA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAAAAAAAAAPCICBKU";

function readL(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(28);
}

test("L is the actual byte length of the strkey, for every address type", () => {
  for (const address of [C_ADDRESS, G_ADDRESS, M_ADDRESS]) {
    const hook = buildHookData(address);
    assert.equal(
      readL(hook),
      address.length,
      `L must equal the strkey length for ${address[0]}-addresses`
    );
  }
});

test("a C-address is a valid forwardRecipient", () => {
  // Skyhook is a contract, so this is the case the whole design depends on. Circle's
  // `test_validate_hook_data_strkey_types` covers C, G and M as equals.
  const hook = buildHookData(C_ADDRESS);
  const parsed = parseHookData(Buffer.from(hook));
  assert.equal(parsed.forwardRecipient, C_ADDRESS);
});

test("the version field is 0, the only value Circle accepts", () => {
  const hook = buildHookData(C_ADDRESS);
  const version = new DataView(hook.buffer, hook.byteOffset, hook.byteLength).getUint32(24);
  assert.equal(version, 0);
});

test("the magic bytes are left zeroed", () => {
  // Circle ignores bytes 0-23 entirely — both all-zero and its own "cctp-forward" marker parse.
  // We write zeroes, which is the documented way to opt out of Circle's own forwarding.
  const hook = buildHookData(C_ADDRESS);
  assert.ok(hook.subarray(0, 24).every((b) => b === 0));
});

test("a trailing payload sits after the strkey and does not disturb L", () => {
  const payload = new TextEncoder().encode("skyhook-instruction");
  const hook = buildHookData(C_ADDRESS, payload);

  assert.equal(readL(hook), C_ADDRESS.length, "L describes the strkey, not the whole frame");
  assert.equal(hook.length, 32 + C_ADDRESS.length + payload.length);

  const parsed = parseHookData(Buffer.from(hook));
  assert.equal(parsed.forwardRecipient, C_ADDRESS);
  assert.equal(
    Buffer.from(parsed.instruction.replace(/^0x/, ""), "hex").toString("utf8"),
    "skyhook-instruction"
  );
});

test("round-trips through our own parser", () => {
  const payload = Uint8Array.from([1, 2, 3, 4]);
  const hook = buildHookData(G_ADDRESS, payload);
  const parsed = parseHookData(Buffer.from(hook));
  assert.equal(parsed.version, 0);
  assert.equal(parsed.forwardRecipient, G_ADDRESS);
  assert.equal(parsed.instruction, "0x01020304");
});

import test from "node:test";
import assert from "node:assert/strict";
import { buildBurnParameters, buildInstruction, depositParams, STELLAR_DOMAIN } from "../src/index.js";

// SOW D3 asks the payload builder to validate "addresses against the two misconfigurations Circle
// flags as unrecoverable". These tests pin both, and the reason they are worth pinning is in
// EVIDENCE.md §9: once a burn is out, its nonce is spent. A message that cannot be delivered
// cannot be retried, refunded or rebuilt. So the only place these mistakes can be caught is
// before signing, which is what this module exists for.
//
// The addresses below are the real Testnet ones, so the last test can compare against a transfer
// that actually landed rather than against the builder's own idea of itself.

const FORWARDER = "CA66Q2WFBND6V4UEB7RD4SAXSVIWMD6RA4X3U32ELVFGXV5PJK4T4VSZ";
const SKYHOOK = "CCOMST7FEDLYJ5MXZTVKVKMK43AQP2U2AZEZRHE3XHYO6UF6LKC2654F";
const USDC_ON_ARC = "0x3600000000000000000000000000000000000000";
const RECIPIENT = "GC2PHOIIPQNXWF3VHNU4WAMMBVX4WWXG4SMPWO3VMMDKNJDTU53USUCF";
const G_ADDRESS = "GA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQHES5";
const M_ADDRESS = "MA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAAAAAAAAAPCICBKU";

const base = {
  amount: 1_000_000n,
  forwarder: FORWARDER,
  forwardRecipient: SKYHOOK,
  burnToken: USDC_ON_ARC,
};

test("the correct values need no arguments — both addresses default to the forwarder", () => {
  const burn = buildBurnParameters(base);
  assert.equal(burn.mintRecipient, burn.destinationCaller);
  assert.equal(burn.destinationDomain, STELLAR_DOMAIN);
  assert.equal(burn.args.length, 8, "depositForBurnWithHook takes eight arguments");
});

test("mintRecipient as a G… account is refused — Circle's first unrecoverable case", () => {
  assert.throws(
    () => buildBurnParameters({ ...base, mintRecipient: G_ADDRESS }),
    /G… account address.*permanently stuck/s
  );
});

test("mintRecipient as an M… muxed address is refused — Circle names muxed explicitly", () => {
  assert.throws(
    () => buildBurnParameters({ ...base, mintRecipient: M_ADDRESS }),
    /muxed address.*permanently stuck/s
  );
});

test("mintRecipient set to Skyhook's own address names the actual mistake", () => {
  // The plausible error, not a random one: naming the contract that should act on the funds.
  // A generic "must be the forwarder" would leave the reader none the wiser about where their
  // address was supposed to go.
  assert.throws(
    () => buildBurnParameters({ ...base, mintRecipient: SKYHOOK }),
    /Skyhook's own address.*belongs in forwardRecipient/s
  );
});

test("a wrong destinationCaller is refused — Circle's second unrecoverable case", () => {
  assert.throws(
    () => buildBurnParameters({ ...base, destinationCaller: SKYHOOK }),
    /destinationCaller must be CctpForwarder.*permanently stuck/s
  );
});

test("forwardRecipient may not be the forwarder itself", () => {
  // Not one of Circle's two: the forwarder rejects this itself (InvalidForwardRecipient), so the
  // mint reverts and the burn is left undeliverable. Same loss, different cause.
  assert.throws(
    () => buildBurnParameters({ ...base, forwardRecipient: FORWARDER }),
    /must not be CctpForwarder itself/
  );
});

test("a zero amount is refused, because the burn would still spend a nonce", () => {
  assert.throws(() => buildBurnParameters({ ...base, amount: 0 }), /greater than zero/);
});

test("the instruction travels in the hook data, after forwardRecipient", () => {
  const instruction = buildInstruction(RECIPIENT, 2);
  const withIx = buildBurnParameters({ ...base, instruction });
  const without = buildBurnParameters(base);

  assert.ok(withIx.hookData.startsWith(without.hookData), "the frame is unchanged, only extended");
  assert.equal(
    (withIx.hookData.length - without.hookData.length) / 2,
    instruction.length,
    "the hook data grows by exactly the instruction's byte length"
  );
});

test("it reproduces the burn that landed on 2026-09-30, argument for argument", () => {
  // The transfer recorded in EVIDENCE.md §5 row 3: burn 0xd393ec24… → Stellar 058650a9…, a
  // Deposit instruction naming the wrong-asset vault, which the handler refused and the ladder
  // routed to Hold. Those arguments were assembled by hand in scripts/e2e-burn.js; this asserts
  // the library produces the same ones, so adopting it changed nothing about what goes on the
  // wire.
  const vault = "CBUJTJXUM4N2SFYU5B7BLMREA2BPWNYT2RFZ4NSUEONU2FPAT2HG5RMI";
  const instruction = buildInstruction(RECIPIENT, 1, depositParams(vault));
  const burn = buildBurnParameters({ ...base, instruction });

  const forwarderBytes32 =
    "0x3de86ac50b47eaf2840fe23e48179551660fd1072fba6f445d4a6bd7af4ab93e";
  assert.deepEqual(burn.args, [
    1_000_000n,
    27,
    forwarderBytes32, // mintRecipient — the forwarder, read back off-chain in EVIDENCE.md §10
    USDC_ON_ARC,
    forwarderBytes32, // destinationCaller — the same
    500n,
    1000,
    burn.hookData,
  ]);
  assert.equal(instruction.length, 119, "the instruction the relayer reported for that burn");
});

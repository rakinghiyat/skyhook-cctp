// Builds the `depositForBurnWithHook` arguments for a Skyhook transfer, and refuses the address
// mistakes that cannot be undone afterwards (SOW §3, SPEC.md §1).
//
// Every other module here is pure encoding. This is the one that says *no*, and it says it before
// anything is signed — because after the burn there is nothing left to fix. The nonce is spent,
// and a message that cannot be delivered leaves the USDC burned on the source chain with no way
// to mint it. EVIDENCE.md §9 records the one time that happened in this project, and it cost a
// permanently unrecoverable 1 USDC.
//
// Nothing is sent from here. The caller keeps their own wallet client, so this package stays free
// of any chain library — which is also why `args` comes back in the ABI's exact order. That order
// is where a hand-written call goes wrong, and `mintRecipient` and `destinationCaller` sit on
// either side of `burnToken` looking interchangeable when they are not.
import { StrKey } from "@stellar/stellar-sdk";
import { buildHookData, toHex } from "./hook-data.js";

/** Stellar's CCTP domain id. */
export const STELLAR_DOMAIN = 27;

/** Circle's fast-transfer defaults, unchanged across every Testnet run in this project. */
const DEFAULT_MAX_FEE = 500n;
const DEFAULT_MIN_FINALITY_THRESHOLD = 1000;

/**
 * Every address in the burn frame has to be a contract. Circle names the alternative explicitly:
 * a `mintRecipient` pointing at a user or muxed address leaves funds *"permanently stuck and
 * cannot be recovered"*. G… and M… therefore get their own messages rather than a generic one,
 * because those are the two forms someone actually reaches for by mistake.
 */
function assertIsContract(label, value) {
  if (typeof value !== "string" || value === "") {
    throw new Error(`${label} is required, as a Stellar contract strkey (C…)`);
  }
  if (StrKey.isValidEd25519PublicKey(value)) {
    throw new Error(
      `${label} is a G… account address, but must be a contract (C…). Circle: a mintRecipient ` +
        `set to a user address leaves the funds permanently stuck and unrecoverable.`
    );
  }
  if (StrKey.isValidMed25519PublicKey(value)) {
    throw new Error(
      `${label} is an M… muxed address, but must be a contract (C…). Circle names muxed ` +
        `addresses specifically: the funds become permanently stuck and cannot be recovered.`
    );
  }
  if (!StrKey.isValidContract(value)) {
    throw new Error(`${label} is not a valid Stellar strkey: ${value}`);
  }
}

/**
 * Builds the burn parameters for one Skyhook transfer.
 *
 * `mintRecipient` and `destinationCaller` both default to `forwarder`, which is the only correct
 * value for either. They are still accepted as overrides so that passing a wrong one is *caught*
 * rather than quietly impossible to express — a library that cannot be asked the wrong question
 * also cannot warn you that you asked it.
 *
 * @param {object} p
 * @param {bigint|number|string} p.amount        Amount in the source chain's 6-decimal USDC.
 * @param {string} p.forwarder                   `CctpForwarder` contract strkey on Stellar.
 * @param {string} p.forwardRecipient            Skyhook's own contract strkey; travels inside the
 *                                               hook data, never in `mintRecipient`.
 * @param {string} p.burnToken                   USDC's address on the source chain (`0x…`).
 * @param {Uint8Array} [p.instruction]           From `buildInstruction`. Omit for a bare transfer.
 * @param {string} [p.mintRecipient]             Defaults to `forwarder`.
 * @param {string} [p.destinationCaller]         Defaults to `forwarder`.
 * @param {bigint|number} [p.maxFee]
 * @param {number} [p.minFinalityThreshold]
 * @param {number} [p.destinationDomain]         Defaults to Stellar.
 * @returns The named parameters, the hook data, and `args` in `depositForBurnWithHook` order.
 */
export function buildBurnParameters({
  amount,
  forwarder,
  forwardRecipient,
  burnToken,
  instruction = new Uint8Array(0),
  mintRecipient = forwarder,
  destinationCaller = forwarder,
  maxFee = DEFAULT_MAX_FEE,
  minFinalityThreshold = DEFAULT_MIN_FINALITY_THRESHOLD,
  destinationDomain = STELLAR_DOMAIN,
}) {
  // A zero-amount burn still spends a nonce, so it is a mistake worth catching rather than a
  // harmless no-op.
  const value = BigInt(amount ?? 0);
  if (value <= 0n) {
    throw new Error(`amount must be greater than zero, got ${amount}`);
  }

  assertIsContract("forwarder", forwarder);
  assertIsContract("forwardRecipient", forwardRecipient);
  assertIsContract("mintRecipient", mintRecipient);
  assertIsContract("destinationCaller", destinationCaller);

  // Circle's first unrecoverable misconfiguration. The likeliest way to reach it is not a random
  // address but a perfectly reasonable one: Skyhook's, on the assumption that naming the contract
  // that should act on the funds is how you route them there. It is not — that address belongs in
  // `forwardRecipient`, inside the hook data, and the mint always goes to the forwarder.
  if (mintRecipient !== forwarder) {
    throw new Error(
      mintRecipient === forwardRecipient
        ? `mintRecipient is Skyhook's own address. It belongs in forwardRecipient, inside the ` +
          `hook data — the mint always goes to CctpForwarder (${forwarder}), which then forwards. ` +
          `Circle: a wrong mintRecipient leaves the funds permanently stuck and unrecoverable.`
        : `mintRecipient must be CctpForwarder (${forwarder}), got ${mintRecipient}. Circle: a ` +
          `wrong mintRecipient leaves the funds permanently stuck and unrecoverable.`
    );
  }

  // Circle's second. `destinationCaller` restricts who may call `receiveMessage` on the
  // destination chain; anything other than the forwarder means the message this burn produces can
  // never be delivered through it.
  if (destinationCaller !== forwarder) {
    throw new Error(
      `destinationCaller must be CctpForwarder (${forwarder}), got ${destinationCaller}. Circle: ` +
        `a wrong destinationCaller leaves the funds permanently stuck and unrecoverable.`
    );
  }

  // Not one of Circle's two, but the same class of loss and free to check. The forwarder rejects
  // itself as a `forwardRecipient` (`InvalidForwardRecipient`, EVIDENCE.md §9), so the mint would
  // revert — leaving the burn done and undeliverable.
  if (forwardRecipient === forwarder) {
    throw new Error(
      `forwardRecipient must not be CctpForwarder itself — the forwarder rejects that and the ` +
        `mint would revert, stranding the burn. It should be Skyhook's contract address.`
    );
  }

  const hookData = toHex(buildHookData(forwardRecipient, instruction));
  const mintRecipientBytes32 = toHex(StrKey.decodeContract(mintRecipient));
  const destinationCallerBytes32 = toHex(StrKey.decodeContract(destinationCaller));
  const fee = BigInt(maxFee);

  return {
    amount: value,
    destinationDomain,
    mintRecipient: mintRecipientBytes32,
    burnToken,
    destinationCaller: destinationCallerBytes32,
    maxFee: fee,
    minFinalityThreshold,
    hookData,
    // Exactly the ABI's order, so a caller never has to get it right themselves.
    args: [
      value,
      destinationDomain,
      mintRecipientBytes32,
      burnToken,
      destinationCallerBytes32,
      fee,
      minFinalityThreshold,
      hookData,
    ],
  };
}

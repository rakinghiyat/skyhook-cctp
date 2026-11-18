// Builds the `depositForBurnWithHook` arguments for a Skyhook transfer, and refuses address
// mistakes that can't be undone.
//
// These checks run before anything is signed, because after the burn nothing can be fixed. A
// message that can't be delivered leaves the USDC burned with no way to mint it. This project
// lost 1 USDC that way once.
//
// Nothing is sent from here; the caller uses their own wallet client. `args` comes back in the
// ABI's exact order, since `mintRecipient` and `destinationCaller` are easy to swap by hand.
import { StrKey } from "@stellar/stellar-sdk";
import { buildHookData, toHex } from "./hook-data.js";

/** Stellar's CCTP domain id. */
export const STELLAR_DOMAIN = 27;

/** Circle's fast-transfer defaults, used on every Testnet run so far. */
const DEFAULT_MAX_FEE = 500n;
const DEFAULT_MIN_FINALITY_THRESHOLD = 1000;

/**
 * Every address in the burn has to be a contract. Circle warns that a user or muxed
 * `mintRecipient` leaves funds "permanently stuck". G… and M… get their own messages because
 * those are the usual mistakes.
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
 * `mintRecipient` and `destinationCaller` default to `forwarder`, the only correct value. They
 * can still be passed, so a wrong one gets a clear error instead of being silently ignored.
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
  // A zero burn still spends a nonce, so treat it as a mistake.
  const value = BigInt(amount ?? 0);
  if (value <= 0n) {
    throw new Error(`amount must be greater than zero, got ${amount}`);
  }

  assertIsContract("forwarder", forwarder);
  assertIsContract("forwardRecipient", forwardRecipient);
  assertIsContract("mintRecipient", mintRecipient);
  assertIsContract("destinationCaller", destinationCaller);

  // Circle's first unrecoverable mistake. The likely wrong value is Skyhook's own address, but
  // that belongs in `forwardRecipient`. The mint always goes to the forwarder.
  if (mintRecipient !== forwarder) {
    throw new Error(
      mintRecipient === forwardRecipient
        ? `mintRecipient is Skyhook's own address. It belongs in forwardRecipient, inside the ` +
          `hook data. The mint always goes to CctpForwarder (${forwarder}), which then forwards. ` +
          `Circle: a wrong mintRecipient leaves the funds permanently stuck and unrecoverable.`
        : `mintRecipient must be CctpForwarder (${forwarder}), got ${mintRecipient}. Circle: a ` +
          `wrong mintRecipient leaves the funds permanently stuck and unrecoverable.`
    );
  }

  // Circle's second. `destinationCaller` limits who can deliver the message, so anything other
  // than the forwarder means it can never be delivered.
  if (destinationCaller !== forwarder) {
    throw new Error(
      `destinationCaller must be CctpForwarder (${forwarder}), got ${destinationCaller}. Circle: ` +
        `a wrong destinationCaller leaves the funds permanently stuck and unrecoverable.`
    );
  }

  // Not one of Circle's two, but the same kind of loss. The forwarder rejects itself as
  // `forwardRecipient` (`InvalidForwardRecipient`), so the mint would revert after the burn.
  if (forwardRecipient === forwarder) {
    throw new Error(
      `forwardRecipient must not be CctpForwarder itself. The forwarder rejects that and the ` +
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
    // In the ABI's order, so callers don't have to get it right.
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

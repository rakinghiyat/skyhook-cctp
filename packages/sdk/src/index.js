// Skyhook payload builder.
//
// Builds the CCTP burn parameters and the Skyhook instruction that travels with them, and reads
// the same wire format back — a library that could only write a format it cannot read would be
// half a library, and the relayer needs the reading half.
export { buildHookData, toHex } from "./hook-data.js";
export { buildInstruction, depositParams } from "./instruction.js";
export {
  parseCctpMessage,
  parseHookData,
  isFinalized,
  HOOK_DATA_OFFSET,
} from "./cctp-message.js";
export {
  heldAmount,
  buildClaimTransaction,
  feeBumpAndSubmit,
  assertIsClaimOn,
  explainClaimError,
} from "./claim.js";

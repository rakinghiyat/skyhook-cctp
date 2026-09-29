// Sponsored claim from the command line — the recipient signs, the sponsor pays.
//
// SOW D2: "claim() runs inside a fee-bump transaction, so the recipient needs no XLM."
//
// Nothing in `handler-hold` knows about this. `claim(recipient)` requires the recipient's
// authorization and nothing else; who pays the fee is decided outside the contract entirely, by
// wrapping the recipient's signed transaction in a fee-bump envelope. That separation is the
// point: an application that wants to spare its users the cost of receiving can do so without
// Skyhook granting it any authority over their funds.
//
// The logic lives in `../src/claim.js`, shared with the claim page and the serverless function
// behind it, so the three cannot drift apart. This file is the terminal-shaped front for it.
//
//   build         — print the transaction for the recipient to sign in their wallet
//   submit        — take the signed envelope back, fee-bump it, send it
//   submit-parts  — same, when the wallet hands back a bare signature instead of an envelope
//
// Usage:
//   node scripts/sponsored-claim.js build
//   node scripts/sponsored-claim.js submit <signed-inner-xdr>
//   node scripts/sponsored-claim.js submit-parts <unsigned-xdr> <signature-hex> <hint-hex>
import { Keypair, TransactionBuilder, Networks, xdr } from "@stellar/stellar-sdk";
import { buildClaimTransaction, feeBumpAndSubmit, heldAmount } from "../src/claim.js";
import { loadEnv } from "./env.js";

const env = loadEnv();
const NETWORK = Networks.TESTNET;
const RECIPIENT = process.env.RECIPIENT || env.FREIGHTER_RECIPIENT;

const shared = {
  rpcUrl: env.STELLAR_RPC_URL,
  holdId: env.HANDLER_HOLD_ID,
  networkPassphrase: NETWORK,
};

async function build() {
  const held = await heldAmount({ ...shared, recipient: RECIPIENT });
  if (held === 0n) {
    console.error(`nothing is held for ${RECIPIENT}`);
    process.exit(1);
  }

  const { xdr: unsigned, fee } = await buildClaimTransaction({ ...shared, recipient: RECIPIENT });
  console.log(`recipient : ${RECIPIENT}`);
  console.log(`held      : ${held} (7 decimals)`);
  console.log(`inner fee : ${fee} stroops — the sponsor covers this, not the recipient`);
  console.log(`\n--- sign this XDR in your wallet, do NOT submit ---\n`);
  console.log(unsigned);
}

async function send(signedXdr) {
  const r = await feeBumpAndSubmit({
    rpcUrl: shared.rpcUrl,
    signedXdr,
    sponsorSecret: env.SPONSOR_SECRET_KEY,
    expectedHoldId: shared.holdId,
    networkPassphrase: NETWORK,
  });
  console.log(`inner source (authorizes) : ${r.innerSource}`);
  console.log(`fee account (pays)        : ${r.feeAccount}`);
  console.log(`\nsubmitted ${r.hash}`);
  console.log(`https://stellar.expert/explorer/testnet/tx/${r.hash}`);
}

/**
 * Reassembles an envelope from the pieces some signing interfaces hand back — a signature and
 * its hint rather than a re-serialised transaction.
 *
 * The signature is verified against the transaction's own hash first. A stale signature is the
 * likeliest mistake here: re-simulating changes the fee, which changes the hash, which quietly
 * invalidates a signature that still looks perfectly well-formed.
 */
async function submitParts(unsignedXdr, sigHex, hintHex) {
  const inner = TransactionBuilder.fromXDR(unsignedXdr, NETWORK);
  const signature = Buffer.from(sigHex, "hex");

  if (!Keypair.fromPublicKey(RECIPIENT).verify(inner.hash(), signature)) {
    throw new Error(
      "the signature does not match this transaction — it was signed over a different version. " +
        "Re-simulating changes the fee, and the fee is part of what gets signed."
    );
  }
  console.log("signature valid for this exact transaction : yes");

  inner.signatures.push(
    new xdr.DecoratedSignature({ hint: Buffer.from(hintHex, "hex"), signature })
  );
  await send(inner.toXDR());
}

const [mode, ...args] = process.argv.slice(2);
if (mode === "build") await build();
else if (mode === "submit" && args[0]) await send(args[0]);
else if (mode === "submit-parts" && args.length === 3) await submitParts(...args);
else {
  console.error(
    "usage:\n" +
      "  sponsored-claim.js build\n" +
      "  sponsored-claim.js submit <signed-inner-xdr>\n" +
      "  sponsored-claim.js submit-parts <unsigned-xdr> <signature-hex> <hint-hex>"
  );
  process.exit(1);
}

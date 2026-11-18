// Sponsored claim from the command line: the recipient signs, the sponsor pays.
//
// The Hold contract only needs the recipient's signature. The fee is paid outside the contract
// by wrapping the signed transaction in a fee bump, so a sponsor gets no power over the funds.
//
// The logic is in `../src/claim.js`, shared with the claim page. This is the CLI for it.
//
//   build         print the transaction for the recipient to sign
//   submit        take the signed envelope, fee-bump it, send it
//   submit-parts  same, when the wallet returns a bare signature instead of an envelope
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
  console.log(`inner fee : ${fee} stroops (paid by the sponsor, not the recipient)`);
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
 * Rebuilds an envelope from a bare signature and hint, which some signing tools return.
 *
 * The signature is checked against the hash first. Re-simulating changes the fee and the hash,
 * so a stale signature is the likely mistake and still looks valid.
 */
async function submitParts(unsignedXdr, sigHex, hintHex) {
  const inner = TransactionBuilder.fromXDR(unsignedXdr, NETWORK);
  const signature = Buffer.from(sigHex, "hex");

  if (!Keypair.fromPublicKey(RECIPIENT).verify(inner.hash(), signature)) {
    throw new Error(
      "the signature does not match this transaction. It was signed over a different version. " +
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

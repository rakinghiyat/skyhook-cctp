// Sponsored claim — the recipient signs, someone else pays.
//
// SOW D2: "claim() runs inside a fee-bump transaction, so the recipient needs no XLM."
//
// Nothing in `handler-hold` knows about this. `claim(recipient)` requires the recipient's
// authorization and nothing else; who pays the fee is decided outside the contract entirely, by
// wrapping the recipient's signed transaction in a fee-bump envelope. That separation is the
// point: an application that wants to spare its users the cost of receiving can do so without
// Skyhook granting it any authority over their funds.
//
// Two steps, because the two signatures come from different places:
//
//   build   — construct the inner transaction, simulate it so the Soroban resources are
//             attached, and print the XDR. The recipient signs this in their own wallet.
//   submit  — take that signed XDR, wrap it in a fee-bump paid by the sponsor, and send it.
//
// Usage:
//   node scripts/sponsored-claim.js build
//   node scripts/sponsored-claim.js submit <signed-inner-xdr>
import {
  Keypair,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  rpc,
  Contract,
  Address,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";
import { loadEnv } from "./env.js";

const env = loadEnv();
const server = new rpc.Server(env.STELLAR_RPC_URL);
const NETWORK = Networks.TESTNET;

const RECIPIENT = process.env.RECIPIENT || env.FREIGHTER_RECIPIENT;
const HOLD = env.HANDLER_HOLD_ID;

async function build() {
  const account = await server.getAccount(RECIPIENT);
  const contract = new Contract(HOLD);

  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK })
    .addOperation(
      contract.call("claim", nativeToScVal(Address.fromString(RECIPIENT), { type: "address" }))
    )
    // An hour, because a person is signing this through a wallet and a multi-step web UI.
    // Five minutes looked generous and was not: the first attempt expired as `tx_too_late`
    // while the signature was still being carried between screens.
    .setTimeout(3600)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`simulation failed: ${sim.error}`);
  }

  // Soroban transactions carry their footprint and resource fee, so they must be assembled
  // before signing — a signature over the unassembled transaction would not match what the
  // network validates.
  const prepared = rpc.assembleTransaction(tx, sim).build();

  console.log(`recipient : ${RECIPIENT}`);
  console.log(`contract  : ${HOLD}`);
  console.log(`inner fee : ${prepared.fee} stroops (the sponsor will cover this, not the recipient)`);
  console.log(`\n--- sign this XDR in your wallet, do NOT submit ---\n`);
  console.log(prepared.toXDR());
}

async function submit(signedXdr) {
  const inner = TransactionBuilder.fromXDR(signedXdr, NETWORK);
  if (inner.source !== RECIPIENT) {
    throw new Error(`inner transaction is from ${inner.source}, expected ${RECIPIENT}`);
  }
  if (!inner.signatures?.length) {
    throw new Error("inner transaction carries no signature — sign it in the wallet first");
  }
  await sendFeeBumped(inner);
}

/**
 * Same as `submit`, but assembled from the pieces a wallet UI hands back.
 *
 * Some signing interfaces show the signature and its hint rather than a re-serialised envelope,
 * so the caller has the unsigned XDR and the signature separately. Reassembling them here is
 * safe because the signature is verified against the transaction's own hash first: if the two
 * do not belong together — a stale signature after the transaction was re-simulated, say — this
 * refuses rather than submitting something the signer never agreed to.
 */
async function submitParts(unsignedXdr, sigHex, hintHex) {
  const inner = TransactionBuilder.fromXDR(unsignedXdr, NETWORK);
  const signature = Buffer.from(sigHex, "hex");

  const signerOk = Keypair.fromPublicKey(RECIPIENT).verify(inner.hash(), signature);
  console.log(`signature valid for this exact transaction : ${signerOk ? "yes" : "NO"}`);
  if (!signerOk) {
    throw new Error(
      "the signature does not match this transaction — it was almost certainly signed over a " +
        "different version. Re-simulating changes the fee, which changes the hash."
    );
  }

  inner.signatures.push(
    new xdr.DecoratedSignature({ hint: Buffer.from(hintHex, "hex"), signature })
  );
  await sendFeeBumped(inner);
}

/** Wraps an already-signed inner transaction in a fee bump paid by the sponsor. */
async function sendFeeBumped(inner) {
  const sponsor = Keypair.fromSecret(env.SPONSOR_SECRET_KEY);
  const feeBump = TransactionBuilder.buildFeeBumpTransaction(
    sponsor,
    String(BigInt(inner.fee) + BigInt(BASE_FEE) * 100n),
    inner,
    NETWORK
  );
  feeBump.sign(sponsor);

  console.log(`inner source (authorizes)  : ${inner.source}`);
  console.log(`fee account (pays)         : ${sponsor.publicKey()}`);
  console.log(`fee bump fee               : ${feeBump.fee} stroops`);

  const sent = await server.sendTransaction(feeBump);
  if (sent.status === "ERROR") {
    throw new Error(`rejected: ${JSON.stringify(sent.errorResult)}`);
  }
  console.log(`\nsubmitted ${sent.hash}`);
  console.log(`https://stellar.expert/explorer/testnet/tx/${sent.hash}`);
}

const [mode, ...args] = process.argv.slice(2);
if (mode === "build") await build();
else if (mode === "submit" && args[0]) await submit(args[0]);
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

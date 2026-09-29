// Claiming funds out of the Hold handler, with or without a sponsor.
//
// Unlike the rest of this package, these functions talk to the network. They live here rather
// than in any one caller because three separate things need exactly this logic and must not
// drift apart: the CLI script, the claim page in the browser, and the serverless function that
// pays on the recipient's behalf.
//
// The split between building and submitting is not incidental. `claim(recipient)` requires the
// recipient's authorization and nothing else, so the transaction has to be signed by them —
// but who *pays* for it is decided afterwards, in an envelope that cannot alter what was
// signed. That is what lets an application cover its users' fees without being trusted with
// anything.
import {
  Keypair,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  rpc,
  Contract,
  Address,
  nativeToScVal,
  scValToNative,
} from "@stellar/stellar-sdk";

/** How much is waiting for this recipient, at Stellar's 7 decimals. `0n` when nothing is. */
export async function heldAmount({ rpcUrl, holdId, recipient, networkPassphrase = Networks.TESTNET }) {
  const server = new rpc.Server(rpcUrl);
  const account = await server.getAccount(recipient);
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase })
    .addOperation(
      new Contract(holdId).call(
        "held",
        nativeToScVal(Address.fromString(recipient), { type: "address" })
      )
    )
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`could not read held balance: ${sim.error}`);
  return BigInt(scValToNative(sim.result.retval));
}

/**
 * Builds the claim for the recipient to sign.
 *
 * The transaction is simulated and assembled first: a Soroban transaction carries its own
 * footprint and resource fee, and a signature over an unassembled one would not match what the
 * network validates.
 *
 * The timebound is deliberately long. A person is signing this through a wallet, and five
 * minutes — which looks generous — expired mid-flow the first time this was done by hand.
 */
export async function buildClaimTransaction({
  rpcUrl,
  holdId,
  recipient,
  networkPassphrase = Networks.TESTNET,
  timeoutSeconds = 3600,
}) {
  const server = new rpc.Server(rpcUrl);
  const account = await server.getAccount(recipient);

  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase })
    .addOperation(
      new Contract(holdId).call(
        "claim",
        nativeToScVal(Address.fromString(recipient), { type: "address" })
      )
    )
    .setTimeout(timeoutSeconds)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(explainClaimError(sim.error));
  }

  const prepared = rpc.assembleTransaction(tx, sim).build();
  return { xdr: prepared.toXDR(), fee: prepared.fee };
}

/**
 * Wraps an already-signed claim in a fee bump the sponsor pays, and submits it.
 *
 * Refuses anything that is not a signed `claim` on the expected Hold contract. Without that
 * check this would be a free fee-payer for any transaction at all — ordinary input validation,
 * not the anti-abuse machinery that a production sponsor would also need.
 */
export async function feeBumpAndSubmit({
  rpcUrl,
  signedXdr,
  sponsorSecret,
  expectedHoldId,
  networkPassphrase = Networks.TESTNET,
}) {
  const inner = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);

  if (!inner.signatures?.length) {
    throw new Error("the transaction carries no signature — the recipient must sign it first");
  }
  if (expectedHoldId) assertIsClaimOn(inner, expectedHoldId);

  const sponsor = Keypair.fromSecret(sponsorSecret);
  const feeBump = TransactionBuilder.buildFeeBumpTransaction(
    sponsor,
    String(BigInt(inner.fee) + BigInt(BASE_FEE) * 100n),
    inner,
    networkPassphrase
  );
  feeBump.sign(sponsor);

  const server = new rpc.Server(rpcUrl);
  const sent = await server.sendTransaction(feeBump);
  if (sent.status === "ERROR") {
    throw new Error(`rejected: ${JSON.stringify(sent.errorResult)}`);
  }

  return {
    hash: sent.hash,
    feeAccount: sponsor.publicKey(),
    innerSource: inner.source,
  };
}

/** Throws unless this transaction is a single `claim` call on the given contract. */
export function assertIsClaimOn(tx, holdId) {
  const ops = tx.operations ?? [];
  if (ops.length !== 1) {
    throw new Error(`expected one operation, found ${ops.length}`);
  }
  const op = ops[0];
  if (op.type !== "invokeHostFunction") {
    throw new Error(`expected a contract invocation, found ${op.type}`);
  }

  // `func.value` is the armed union's payload; on an InvokeContract host function it holds the
  // contract address and the function name as plain fields, not accessors.
  const invocation = op.func?.value;
  if (!invocation?.contractAddress) {
    throw new Error("this is not a contract invocation");
  }

  const contract = Address.fromScAddress(invocation.contractAddress).toString();
  const fn = String(invocation.functionName);

  if (contract !== holdId) {
    throw new Error(`this calls ${contract}, not the Hold handler`);
  }
  if (fn !== "claim") {
    throw new Error(`this calls ${fn}, not claim`);
  }
}

/** Names the failures a claim actually hits, rather than passing the raw code along. */
export function explainClaimError(raw) {
  const text = String(raw);
  if (/#13\b/.test(text)) {
    return (
      "the recipient has no USDC trustline, so the payout has nowhere to land. Add the USDC " +
      "asset in the wallet first — the held balance is untouched until then."
    );
  }
  if (/#6908\b/.test(text)) {
    return "already claimed — nothing further is needed.";
  }
  return text;
}

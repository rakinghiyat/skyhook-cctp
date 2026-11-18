// Claiming funds out of the Hold handler, with or without a sponsor.
//
// Unlike the rest of this package, these functions use the network. They live here so the CLI
// script, the claim page and the sponsor function all share one copy.
//
// Building and submitting are separate on purpose. The recipient signs the claim; who pays is
// decided later, in a fee bump that can't change what was signed. So an app can pay its users'
// fees without being trusted with their funds.
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
 * It is simulated and assembled first, because a Soroban transaction carries its own footprint
 * and fee, and a signature over the unassembled one wouldn't match.
 *
 * The timeout is long on purpose. A person signs this in a wallet, and five minutes ran out
 * the first time we tried it by hand.
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
 * Wraps a signed claim in a fee bump paid by the sponsor, and submits it.
 *
 * Refuses anything that isn't a signed `claim` on the expected Hold contract. Otherwise the
 * sponsor would pay for any transaction. This is basic validation, not full anti-abuse.
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
    throw new Error("the transaction has no signature. The recipient must sign it first.");
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

  // `func.value` is the union's payload. For InvokeContract it has the contract address and
  // function name as plain fields, not accessors.
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

/** Turns the common claim failures into readable messages. */
export function explainClaimError(raw) {
  const text = String(raw);
  if (/#13\b/.test(text)) {
    return (
      "the recipient has no USDC trustline, so the payout has nowhere to land. Add the USDC " +
      "asset in the wallet first. The held balance stays put until then."
    );
  }
  if (/#6908\b/.test(text)) {
    return "already claimed. Nothing more to do.";
  }
  return text;
}

// Submits Skyhook.execute(message, attestation) to Stellar.
//
// The relayer takes no custody of anything: it never holds the USDC being transferred, and its
// only cost is the fee for this one invocation, paid from its own account. That is what makes
// running one permissionless — Skyhook depends on the role existing, not on any particular
// operator.
import {
  Keypair,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  rpc,
  xdr,
  Address,
  Contract,
} from "@stellar/stellar-sdk";

function hexToScvBytes(hex) {
  return xdr.ScVal.scvBytes(Buffer.from(hex.replace(/^0x/, ""), "hex"));
}

export async function submitExecute({
  rpcUrl,
  networkPassphrase = Networks.TESTNET,
  secretKey,
  coreId,
  horizonUrl,
  message,
  attestation,
  log,
}) {
  const server = new rpc.Server(rpcUrl);
  const keypair = Keypair.fromSecret(secretKey);
  const account = await server.getAccount(keypair.publicKey());
  log(`submitting from ${keypair.publicKey()}`);

  const contract = new Contract(coreId);
  const operation = contract.call(
    "execute",
    hexToScvBytes(message),
    hexToScvBytes(attestation)
  );

  const built = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(operation)
    .setTimeout(60)
    .build();

  const simulated = await server.simulateTransaction(built);
  if (rpc.Api.isSimulationError(simulated)) {
    throw new Error(explainSimulationError(simulated.error));
  }
  log(`  simulated; min resource fee ${simulated.minResourceFee}`);

  const prepared = rpc.assembleTransaction(built, simulated).build();
  prepared.sign(keypair);

  const sent = await server.sendTransaction(prepared);
  if (sent.status === "ERROR") {
    throw new Error(`submission rejected: ${JSON.stringify(sent.errorResult)}`);
  }
  log(`  submitted ${sent.hash}, waiting for confirmation`);

  // Confirmation comes from Horizon rather than the RPC's getTransaction, for two reasons
  // learned by running this for real:
  //
  //   - getTransaction parses the transaction meta as XDR, and an SDK older than the network's
  //     protocol fails with "Bad union switch" on a transaction that in fact succeeded.
  //   - it can block far longer than any deadline checked between calls, so a hung call cannot
  //     be interrupted by a timeout the loop enforces itself.
  //
  // Horizon returns plain JSON with a `successful` flag, and a 404 simply means "not yet".
  // Reporting a successful transaction as failed is the worst outcome available here — an
  // operator would resubmit something that already landed — so this path is deliberately the
  // boring one.
  const confirmed = await confirmViaHorizon({ horizonUrl, hash: sent.hash, log });
  if (!confirmed) {
    throw new Error(
      `submitted ${sent.hash} but could not confirm it within the timeout — check ` +
        `https://stellar.expert/explorer/testnet/tx/${sent.hash} before resubmitting, ` +
        `it may well have succeeded`
    );
  }
  return sent.hash;
}

async function confirmViaHorizon({ horizonUrl, hash, timeoutMs = 90_000, log }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 10_000);
      const res = await fetch(`${horizonUrl}/transactions/${hash}`, {
        signal: controller.signal,
      });
      clearTimeout(t);
      if (res.status === 200) {
        const body = await res.json();
        if (body.successful) return true;
        throw new Error(`transaction ${hash} failed on-chain`);
      }
      // 404 means Horizon has not ingested it yet.
    } catch (err) {
      if (err.message?.includes("failed on-chain")) throw err;
      // Network hiccup — keep waiting rather than declaring failure.
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

/**
 * Turns a contract error code into something that says what to do about it.
 *
 * A raw `Error(Contract, #6908)` buried in a page of XDR tells an operator nothing, and the
 * commonest case — relaying a burn that already landed — is not a fault at all. Naming it is
 * the difference between "something broke" and "this is already done".
 */
function explainSimulationError(raw) {
  const text = String(raw);
  const code = text.match(/Error\(Contract, #(\d+)\)/)?.[1];

  // From circlefin/stellar-cctp, message-transmitter-v2: NonceAlreadyUsed = 6908.
  if (code === "6908") {
    return (
      "this burn has already been relayed — CCTP refuses to process the same message twice " +
      "(NonceAlreadyUsed). Nothing is wrong and nothing needs resubmitting; check the recipient's " +
      "balance to see the result of the run that succeeded."
    );
  }

  return code
    ? `simulation failed with contract error #${code}: ${text}`
    : `simulation failed: ${text}`;
}

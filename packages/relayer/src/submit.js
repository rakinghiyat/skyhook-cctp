// Submits Skyhook.execute(message, attestation) to Stellar.
//
// The relayer never holds the USDC. It only pays the fee for this call from its own account,
// so anyone can run one. Skyhook needs someone to relay, not a specific operator.
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

  // We confirm through Horizon, not the RPC's getTransaction, for two reasons:
  //
  //   - getTransaction parses XDR meta, and an older SDK fails with "Bad union switch" on a
  //     transaction that actually succeeded.
  //   - it can hang past our timeout.
  //
  // Horizon returns plain JSON with a `successful` flag; 404 means "not yet". Calling a success
  // a failure is the worst case here, since an operator would resubmit.
  const confirmed = await confirmViaHorizon({ horizonUrl, hash: sent.hash, log });
  if (!confirmed) {
    throw new Error(
      `submitted ${sent.hash} but could not confirm it within the timeout. Check ` +
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
      // Network hiccup, keep waiting.
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

/**
 * Turns a contract error code into advice.
 *
 * The most common one, #6908, just means the burn was already relayed. That's not a failure.
 */
function explainSimulationError(raw) {
  const text = String(raw);
  const code = text.match(/Error\(Contract, #(\d+)\)/)?.[1];

  // From circlefin/stellar-cctp, message-transmitter-v2: NonceAlreadyUsed = 6908.
  if (code === "6908") {
    return (
      "this burn has already been relayed. CCTP won't process the same message twice " +
      "(NonceAlreadyUsed). Nothing is wrong and nothing needs resubmitting; check the recipient's " +
      "balance to see the result of the run that succeeded."
    );
  }

  return code
    ? `simulation failed with contract error #${code}: ${text}`
    : `simulation failed: ${text}`;
}

// Gate Q2/Q3/Q4 — burn with forwardRecipient = the deployed skyhook-core probe contract,
// plus a trailing test payload, so we can check after the fact whether:
//   Q2/Q4: mint_and_forward can be called from another contract, and funds land there
//   Q3:    the trailing payload survives the burn -> attestation round trip intact
import { createWalletClient, createPublicClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { StrKey } from "@stellar/stellar-sdk";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { loadEnv, repoRoot } from "./env.js";
import { buildHookData, toHex } from "./hook-data.js";

const env = loadEnv();

const chain = {
  id: Number(env.SOURCE_CHAIN_ID),
  name: "arc-testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [env.SOURCE_RPC_URL] } },
};

const account = privateKeyToAccount(env.SOURCE_PRIVATE_KEY);
const publicClient = createPublicClient({ chain, transport: http(env.SOURCE_RPC_URL) });
const walletClient = createWalletClient({ account, chain, transport: http(env.SOURCE_RPC_URL) });

const usdcAbi = parseAbi(["function approve(address spender, uint256 value) returns (bool)"]);
const tokenMessengerAbi = parseAbi([
  "function depositForBurnWithHook(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold, bytes hookData) returns (uint64)",
]);

function strkeyToBytes32(strkey) {
  const raw = StrKey.decodeContract(strkey);
  if (raw.length !== 32) throw new Error(`expected 32 raw bytes, got ${raw.length}`);
  return toHex(raw);
}

async function main() {
  const amount = 1_000_000n;
  const maxFee = 500n;
  const minFinalityThreshold = 1000;
  const destinationDomain = 27;

  const forwarderBytes32 = strkeyToBytes32(env.CCTP_FORWARDER_ID);
  const testPayload = new TextEncoder().encode("SKYHOOK-GATE-TEST-Q3-PAYLOAD-INTACT-CHECK");
  // forwardRecipient = skyhook-core probe contract, NOT the relayer G-address this time.
  const hookData = toHex(buildHookData(env.SKYHOOK_CORE_ID, testPayload));

  console.log("Burning from:", account.address);
  console.log("forwardRecipient (skyhook-core probe):", env.SKYHOOK_CORE_ID);
  console.log("test payload (utf8):", new TextDecoder().decode(testPayload));
  console.log("hookData:", hookData);

  const approveTx = await walletClient.writeContract({
    address: env.ARC_USDC,
    abi: usdcAbi,
    functionName: "approve",
    args: [env.ARC_TOKEN_MESSENGER, amount],
  });
  console.log("approve tx:", approveTx);
  await publicClient.waitForTransactionReceipt({ hash: approveTx });

  const burnTx = await walletClient.writeContract({
    address: env.ARC_TOKEN_MESSENGER,
    abi: tokenMessengerAbi,
    functionName: "depositForBurnWithHook",
    args: [
      amount,
      destinationDomain,
      forwarderBytes32,
      env.ARC_USDC,
      forwarderBytes32,
      maxFee,
      minFinalityThreshold,
      hookData,
    ],
  });
  console.log("burn tx:", burnTx);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: burnTx });
  console.log("burn confirmed in block:", receipt.blockNumber, "status:", receipt.status);

  const outPath = path.join(repoRoot, "packages/sdk/scripts/.gate-burn-2-result.json");
  writeFileSync(
    outPath,
    JSON.stringify(
      { approveTx, burnTx, amount: amount.toString(), testPayloadUtf8: new TextDecoder().decode(testPayload) },
      null,
      2
    )
  );
  console.log("Wrote", outPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

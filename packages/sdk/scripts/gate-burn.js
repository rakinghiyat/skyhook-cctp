// Week 1 gate — baseline CCTP transfer (SOW §5.1 Days 1-2, EVIDENCE.md §2 row 1).
//
// Burns USDC on Arc Testnet via depositForBurnWithHook, with forwardRecipient in the hook
// data set to the relayer's own Stellar account (a plain G-address, no contract logic) —
// this baseline only proves burn -> attestation -> mint_and_forward works at all. It does
// NOT yet test cross-contract callability (gate Q2/Q3) — that needs the skyhook-core probe,
// a separate step.
//
// ABI for depositForBurnWithHook confirmed against the verified TokenMessengerV2
// implementation on testnet.arcscan.app (0xF07C0ad13178a9ef5c3fFA0Be69e0BECd452Bf6D), not
// assumed from documentation.
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

const usdcAbi = parseAbi([
  "function approve(address spender, uint256 value) returns (bool)",
  "function decimals() view returns (uint8)",
]);
const tokenMessengerAbi = parseAbi([
  "function depositForBurnWithHook(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold, bytes hookData) returns (uint64)",
]);

// Stellar strkey -> raw 32 bytes -> left-padded to bytes32 for the EVM side.
function strkeyToBytes32(strkey) {
  const raw = StrKey.decodeContract(strkey); // 32 bytes for a C... contract address
  if (raw.length !== 32) throw new Error(`expected 32 raw bytes, got ${raw.length}`);
  return toHex(raw);
}

async function main() {
  const amount = 1_000_000n; // 1 USDC at 6 decimals — small, deliberate gate amount
  const maxFee = 500n;
  const minFinalityThreshold = 1000; // "fast" transfer, matching Circle's own quickstart example
  const destinationDomain = 27; // Stellar

  const forwarderBytes32 = strkeyToBytes32(env.CCTP_FORWARDER_ID);
  const hookData = toHex(buildHookData(env.RELAYER_PUBLIC_KEY));

  console.log("Burning from:", account.address);
  console.log("mintRecipient / destinationCaller (CctpForwarder):", forwarderBytes32);
  console.log("hookData (forwardRecipient = relayer G-address, no extra payload):", hookData);

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

  const outPath = path.join(repoRoot, "packages/sdk/scripts/.gate-burn-result.json");
  writeFileSync(outPath, JSON.stringify({ approveTx, burnTx, amount: amount.toString() }, null, 2));
  console.log("Wrote", outPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// End-to-end run against the deployed skyhook-core: burns on Arc with a real Skyhook
// instruction attached, so the core parses it, tries to route it, and falls back.
import { createWalletClient, createPublicClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { loadEnv, repoRoot } from "./env.js";
import { buildInstruction, depositParams } from "../src/instruction.js";
import { buildBurnParameters } from "../src/burn.js";

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

async function main() {
  // USDC has six decimals on the source chain; AMOUNT is in whole USDC.
  const amount = BigInt(Math.round(Number(process.env.AMOUNT ?? 1) * 1_000_000));
  const handlerId = Number(process.argv[2] ?? 1);

  // Defaults to the Freighter demo account — a recipient that cannot yet receive USDC, which
  // is the case Hold exists for. Override with RECIPIENT=G... to aim somewhere else.
  const recipient = process.env.RECIPIENT || env.FREIGHTER_RECIPIENT || env.RELAYER_PUBLIC_KEY;

  // Deposit (handler_id 1) carries the vault address in params; every other handler here
  // carries none. VAULT=C... overrides the vault, including with a deliberately wrong one.
  const params =
    handlerId === 1
      ? depositParams(process.env.VAULT || env.REFERENCE_VAULT_ID)
      : new Uint8Array(0);

  const instruction = buildInstruction(recipient, handlerId, params);

  // The library assembles the burn and refuses the addresses Circle calls unrecoverable, so this
  // script no longer decides any of it — which is the point: what a sender runs is the same code
  // path the package ships.
  const burn = buildBurnParameters({
    amount,
    forwarder: env.CCTP_FORWARDER_ID,
    forwardRecipient: env.SKYHOOK_CORE_ID,
    burnToken: env.ARC_USDC,
    instruction,
  });

  console.log("core:            ", env.SKYHOOK_CORE_ID);
  console.log("handler_id:      ", handlerId);
  console.log("fallback_recipient:", recipient);
  if (params.length) console.log("vault:           ", new TextDecoder().decode(params));
  console.log("instruction bytes:", instruction.length);

  const approveTx = await walletClient.writeContract({
    address: env.ARC_USDC,
    abi: usdcAbi,
    functionName: "approve",
    args: [env.ARC_TOKEN_MESSENGER, amount],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveTx });

  const burnTx = await walletClient.writeContract({
    address: env.ARC_TOKEN_MESSENGER,
    abi: tokenMessengerAbi,
    functionName: "depositForBurnWithHook",
    args: burn.args,
  });
  console.log("burn tx:", burnTx);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: burnTx });
  console.log("confirmed in block:", receipt.blockNumber, "status:", receipt.status);

  const outPath = path.join(repoRoot, "packages/sdk/scripts/.e2e-burn-result.json");
  writeFileSync(outPath, JSON.stringify({ burnTx, handlerId, recipient }, null, 2));
  console.log("Wrote", outPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

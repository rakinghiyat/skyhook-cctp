#!/usr/bin/env node
// relay <burnTxHash>
//
// Drives one CCTP burn to completion: wait for Circle's attestation, re-attest if the message
// never reached finality, read the message ourselves, and submit it to Skyhook.
//
// Nothing runs an attached instruction until a relayer does this. The forwarder credits the
// recipient rather than invoking it, so without this step the funds arrive and sit there.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isFinalized } from "@skyhook-cctp/sdk";
import { awaitAttestation, requestReattestation, reportRawHexParse } from "./relay.js";
import { submitExecute } from "./submit.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function loadEnv() {
  const text = readFileSync(path.join(repoRoot, ".env"), "utf8");
  const env = {};
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    env[t.slice(0, eq)] = t.slice(eq + 1).replace(/^"(.*)"$/, "$1");
  }
  return env;
}

const stamp = () => new Date().toISOString().slice(11, 19);
const log = (msg) => console.log(`[${stamp()}] ${msg}`);

async function main() {
  const burnTxHash = process.argv[2];
  if (!burnTxHash) {
    console.error("usage: relay <burnTxHash>");
    process.exit(1);
  }

  const env = loadEnv();
  const api = env.CIRCLE_ATTESTATION_API;

  // Fail here with something actionable rather than deep inside the Stellar SDK, where an
  // empty key surfaces as "invalid version byte" and tells you nothing about the cause.
  const required = ["CIRCLE_ATTESTATION_API", "SOURCE_DOMAIN_ID", "STELLAR_RPC_URL", "STELLAR_HORIZON_URL", "SKYHOOK_CORE_ID"];
  const missing = required.filter((k) => !env[k]);
  if (missing.length) {
    throw new Error(`missing in .env: ${missing.join(", ")}`);
  }
  if (!env.RELAYER_SECRET_KEY) {
    throw new Error(
      "RELAYER_SECRET_KEY is empty in .env — the relayer needs its own key to pay the " +
        "invocation fee. Populate it with ./scripts/fill-stellar-keys.sh (the secret is read " +
        "straight from the stellar CLI keystore and never printed)."
    );
  }

  log(`relaying burn ${burnTxHash}`);
  log(`source domain ${env.SOURCE_DOMAIN_ID} -> Stellar, core ${env.SKYHOOK_CORE_ID}`);

  // 1. Wait for Circle, backing off between attempts.
  const message = await awaitAttestation({
    api,
    sourceDomain: env.SOURCE_DOMAIN_ID,
    burnTxHash,
    log,
  });
  log(`attestation complete, nonce ${message.eventNonce}`);

  // 2. Read it ourselves — this is where the API's null address fields get recovered.
  const parsed = reportRawHexParse(message, log);

  // 3. Re-attest only if the message never reached finality. Asking for a finalized message
  //    would be noise, and pretending otherwise would misrepresent what happened.
  if (isFinalized(parsed)) {
    log(
      `finality ${parsed.finalityThresholdExecuted} >= 2000, so no re-attestation is needed ` +
        `— this burn was attested as finalized`
    );
  } else {
    log(`finality ${parsed.finalityThresholdExecuted} < 2000: this is a pre-finality message`);
    await requestReattestation({ api, nonce: message.eventNonce, log });
  }

  // 4. Submit.
  const hash = await submitExecute({
    rpcUrl: env.STELLAR_RPC_URL,
    horizonUrl: env.STELLAR_HORIZON_URL,
    secretKey: env.RELAYER_SECRET_KEY,
    coreId: env.SKYHOOK_CORE_ID,
    message: message.message,
    attestation: message.attestation,
    log,
  });

  log(`executed: https://stellar.expert/explorer/testnet/tx/${hash}`);
}

main().catch((err) => {
  log(`failed: ${err.message}`);
  process.exit(1);
});

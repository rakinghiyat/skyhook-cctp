#!/usr/bin/env node
// relay <burnTxHash>
//
// Takes one CCTP burn to the end: wait for Circle's attestation, re-attest if it never reached
// finality, read the message, and submit it to Skyhook.
//
// Without a relayer the instruction never runs. The forwarder only credits the recipient, it
// doesn't call it.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { isFinalized } from "@skyhook-cctp/sdk";
import { awaitAttestation, requestReattestation, reportRawHexParse } from "./relay.js";
import { submitExecute } from "./submit.js";

// Walk up from the working directory to find .env. Resolving it relative to this file works
// only inside the repo: once installed, the same "../../.." from
// node_modules/@skyhook-cctp/relayer/src lands on node_modules rather than on the project
// using the relayer, and every run fails on a file that was never there.
function findEnv() {
  let dir = process.cwd();
  for (;;) {
    const candidate = path.join(dir, ".env");
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`no .env found in ${process.cwd()} or any directory above it`);
    dir = parent;
  }
}

let envPath;

function loadEnv() {
  envPath = findEnv();
  const text = readFileSync(envPath, "utf8");
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
    console.error("usage: skyhook-relay <burnTxHash>");
    process.exit(1);
  }

  const env = loadEnv();
  log(`config ${envPath}`);
  const api = env.CIRCLE_ATTESTATION_API;

  // Fail early with a clear message. Deep in the Stellar SDK an empty key just says
  // "invalid version byte".
  const required = ["CIRCLE_ATTESTATION_API", "SOURCE_DOMAIN_ID", "STELLAR_RPC_URL", "STELLAR_HORIZON_URL", "SKYHOOK_CORE_ID"];
  const missing = required.filter((k) => !env[k]);
  if (missing.length) {
    throw new Error(`missing in .env: ${missing.join(", ")}`);
  }
  if (!env.RELAYER_SECRET_KEY) {
    throw new Error(
      "RELAYER_SECRET_KEY is empty in .env. The relayer needs its own key to pay the " +
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

  // 2. Read it ourselves, to recover the address fields the API returns as null.
  const parsed = reportRawHexParse(message, log);

  // 3. Re-attest only if the message never reached finality.
  if (isFinalized(parsed)) {
    log(
      `finality ${parsed.finalityThresholdExecuted} >= 2000, so no re-attestation is needed ` +
        `(this burn was attested as finalized)`
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

// Polls Circle's attestation API for a burn recorded by e2e-burn.js.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadEnv, repoRoot } from "./env.js";

const env = loadEnv();
const burn = JSON.parse(
  readFileSync(path.join(repoRoot, "packages/sdk/scripts/.e2e-burn-result.json"), "utf8")
);

const url = `${env.CIRCLE_ATTESTATION_API}/v2/messages/${env.SOURCE_DOMAIN_ID}?transactionHash=${burn.burnTx}`;
const maxAttempts = 60;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log("Polling:", url);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const body = await (await fetch(url)).json();
    const status = body?.messages?.[0]?.status;
    console.log(`[${new Date().toISOString()}] attempt ${attempt}: status=${status ?? body.error}`);
    if (status === "complete") {
      const outPath = path.join(repoRoot, "packages/sdk/scripts/.e2e-attestation.json");
      writeFileSync(outPath, JSON.stringify(body.messages[0], null, 2));
      console.log("Attestation complete. Wrote", outPath);
      return;
    }
    await sleep(10_000);
  }
  console.error("Gave up without a complete attestation.");
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

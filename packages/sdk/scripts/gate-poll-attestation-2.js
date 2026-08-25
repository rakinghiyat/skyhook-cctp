import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadEnv, repoRoot } from "./env.js";

const env = loadEnv();
const burnResult = JSON.parse(
  readFileSync(path.join(repoRoot, "packages/sdk/scripts/.gate-burn-2-result.json"), "utf8")
);

const url = `${env.CIRCLE_ATTESTATION_API}/v2/messages/${env.SOURCE_DOMAIN_ID}?transactionHash=${burnResult.burnTx}`;
const maxAttempts = 60;
const intervalMs = 10_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log("Polling:", url);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(url);
    const body = await res.json();
    const status = body?.messages?.[0]?.status;
    console.log(`[${new Date().toISOString()}] attempt ${attempt}/${maxAttempts}: status=${status ?? body.error}`);

    if (status === "complete") {
      const outPath = path.join(repoRoot, "packages/sdk/scripts/.gate-attestation-2-result.json");
      writeFileSync(outPath, JSON.stringify(body.messages[0], null, 2));
      console.log("Attestation complete. Wrote", outPath);
      return;
    }
    await sleep(intervalMs);
  }
  console.error("Gave up after", maxAttempts, "attempts without a complete attestation.");
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

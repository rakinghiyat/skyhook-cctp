// Generates a fresh EVM private key for the Arc Testnet gate wallet and writes it directly
// into the repo's .env — never prints the private key. Prints only the public address, which
// is what needs funding via the faucet.
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const envPath = path.join(repoRoot, ".env");

const privateKey = generatePrivateKey();
const account = privateKeyToAccount(privateKey);

let env = readFileSync(envPath, "utf8");
if (!/^SOURCE_PRIVATE_KEY=$/m.test(env)) {
  throw new Error("SOURCE_PRIVATE_KEY= (empty) not found in .env — refusing to guess where to write it");
}
env = env.replace(/^SOURCE_PRIVATE_KEY=$/m, `SOURCE_PRIVATE_KEY=${privateKey}`);
writeFileSync(envPath, env);

console.log(`Arc Testnet wallet address (fund this via faucet): ${account.address}`);
console.log("Private key written to .env — not printed here.");

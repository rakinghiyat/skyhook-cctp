// Minimal .env loader — repo root, no dependency, KEY=VALUE lines only.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const envPath = path.join(repoRoot, ".env");

export function loadEnv() {
  const text = readFileSync(envPath, "utf8");
  const env = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq);
    let value = trimmed.slice(eq + 1);
    value = value.replace(/^"(.*)"$/, "$1");
    env[key] = value;
  }
  return env;
}

export { repoRoot, envPath };

import { setTimeout as sleep } from "node:timers/promises";
import { parseCctpMessage, isFinalized } from "@skyhook-cctp/sdk";
import { fetchJson } from "./http.js";
import { backoffSchedule } from "./backoff.js";

/**
 * Polls Circle for a burn's attestation, backing off between attempts.
 *
 * Returns the attested message, or throws when the schedule runs out. Each attempt logs its
 * delay, so the log shows the backoff growing.
 */
export async function awaitAttestation({ api, sourceDomain, burnTxHash, log, wait = sleep }) {
  const url = `${api}/v2/messages/${sourceDomain}?transactionHash=${burnTxHash}`;
  const schedule = backoffSchedule();
  log(`polling ${url}`);

  for (const [i, delay] of schedule.entries()) {
    const { status, json } = await fetchJson(url, { log });
    const message = json?.messages?.[0];
    const state = message?.status ?? json?.error ?? `http ${status}`;
    log(`  attempt ${i + 1}/${schedule.length}: ${state}`);

    if (message?.status === "complete") return message;

    if (status === 429) {
      log(`  rate limited by Circle, backing off`);
    }

    log(`  waiting ${delay}ms before the next attempt`);
    await wait(delay);
  }
  throw new Error(`no attestation after ${schedule.length} attempts`);
}

/**
 * Asks Circle to re-attest a message at finalized level.
 *
 * Only needed for a fast transfer whose attestation expired before anyone used it.
 */
export async function requestReattestation({ api, nonce, log }) {
  const url = `${api}/v2/reattest/${nonce}`;
  log(`requesting re-attestation: POST ${url}`);
  const { status, json } = await fetchJson(url, { method: "POST", log });
  log(`  Circle responded ${status}: ${JSON.stringify(json)}`);
  return { status, json };
}

/**
 * Reads the message ourselves and reports what the API left out.
 *
 * Circle's API returns every address field as null for Stellar, because it can't tell an
 * account from a contract. The values are in the raw message, so we read them there.
 */
export function reportRawHexParse(message, log) {
  const parsed = parseCctpMessage(message.message);
  const api = message.decodedMessage;

  const nulled = [
    ["recipient", api?.recipient, parsed.recipient],
    ["destinationCaller", api?.destinationCaller, parsed.destinationCaller],
    ["mintRecipient", api?.decodedMessageBody?.mintRecipient, parsed.body.mintRecipient],
  ].filter(([, fromApi]) => fromApi === null || fromApi === undefined);

  if (nulled.length) {
    log(`Circle's API returned ${nulled.length} address field(s) as null; read from raw hex:`);
    for (const [name, , recovered] of nulled) log(`  ${name}: ${recovered}`);
    if (parsed.body.mintRecipientStrkey) {
      log(`  mintRecipient as a Stellar address: ${parsed.body.mintRecipientStrkey}`);
    }
  } else {
    log(`Circle's API returned every address field, nothing to recover`);
  }

  log(`route: domain ${parsed.sourceDomain} -> ${parsed.destinationDomain}`);
  log(`amount: ${parsed.body.amount} (source decimals)`);
  log(`finality: requested ${parsed.minFinalityThreshold}, executed ${parsed.finalityThresholdExecuted}`);
  if (parsed.hook) {
    log(`forwardRecipient: ${parsed.hook.forwardRecipient}`);
    log(`Skyhook instruction: ${parsed.hook.instruction.length / 2 - 1} bytes`);
  }
  return parsed;
}

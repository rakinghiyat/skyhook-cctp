import { setTimeout as sleep } from "node:timers/promises";
import { parseCctpMessage, isFinalized } from "@skyhook-cctp/sdk";
import { fetchJson } from "./http.js";
import { backoffSchedule } from "./backoff.js";

/**
 * Polls Circle for the attestation of a burn, backing off between attempts.
 *
 * Returns the attested message, or throws once the schedule is exhausted. Every attempt is
 * logged with the delay that preceded it, so a transcript shows the backoff actually widening
 * rather than merely claiming to.
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
      log(`  rate limited by Circle — backing off is the correct response, not retrying harder`);
    }

    log(`  waiting ${delay}ms before the next attempt`);
    await wait(delay);
  }
  throw new Error(`no attestation after ${schedule.length} attempts`);
}

/**
 * Asks Circle to re-attest a pre-finality message at finalized level.
 *
 * Only meaningful for a message that was attested below finality — a fast transfer whose
 * attestation expired before anyone used it. A finalized message needs nothing, and asking anyway
 * would be noise.
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
 * This is the whole reason the relayer parses raw hex: Circle's Get Messages endpoint returns
 * every address field as null for Stellar, because it cannot tell a 32-byte account from a
 * 32-byte contract. The values were in the message the entire time.
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
    log(`Circle's API returned every address field populated — nothing to recover`);
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

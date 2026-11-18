// Exponential backoff with a ceiling.
//
// Circle rate-limits the attestation API (40 requests/second for everyone), and an attestation
// can take seconds or minutes. Polling at a fixed fast rate just gets us rate-limited.

/**
 * Delays for each attempt: `base`, doubling each time, capped at `ceiling`.
 * Pure, so tests can check the schedule without waiting.
 */
export function backoffSchedule({ base = 2000, ceiling = 30000, attempts = 20 } = {}) {
  const out = [];
  let delay = base;
  for (let i = 0; i < attempts; i++) {
    out.push(delay);
    delay = Math.min(delay * 2, ceiling);
  }
  return out;
}

/** Total time a full schedule waits, in milliseconds. */
export function scheduleDuration(schedule) {
  return schedule.reduce((a, b) => a + b, 0);
}

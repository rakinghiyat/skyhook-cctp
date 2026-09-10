// Exponential backoff with a ceiling.
//
// Circle rate-limits the attestation API (40 requests/second across all callers), and an
// attestation takes anywhere from seconds to minutes depending on the source chain's finality.
// Hammering it at a fixed interval is both rude and, under rate limiting, counterproductive.

/**
 * Delays for successive attempts: `base`, doubling each time, capped at `ceiling`.
 * Pure and synchronous so the schedule can be asserted in tests rather than observed by waiting.
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

/** Total wall-clock time a full schedule would spend waiting, in milliseconds. */
export function scheduleDuration(schedule) {
  return schedule.reduce((a, b) => a + b, 0);
}

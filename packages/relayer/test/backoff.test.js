import test from "node:test";
import assert from "node:assert/strict";
import { backoffSchedule, scheduleDuration } from "../src/backoff.js";
import { awaitAttestation } from "../src/relay.js";

test("delays double until they hit the ceiling, then hold there", () => {
  const s = backoffSchedule({ base: 1000, ceiling: 8000, attempts: 6 });
  assert.deepEqual(s, [1000, 2000, 4000, 8000, 8000, 8000]);
});

test("the default schedule waits long enough to be useful without running forever", () => {
  const total = scheduleDuration(backoffSchedule());
  // Circle's attestations have arrived in seconds in practice, but finality on a slow source
  // chain can take minutes. Minutes of patience, not hours of hanging.
  assert.ok(total > 5 * 60_000, `expected over 5 minutes of patience, got ${total}ms`);
  assert.ok(total < 30 * 60_000, `expected under 30 minutes, got ${total}ms`);
});

test("gives up rather than polling forever", async () => {
  const logs = [];
  let waited = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    status: 404,
    json: async () => ({ error: "Message not found for provided parameters" }),
  });

  try {
    await assert.rejects(
      awaitAttestation({
        api: "https://example.invalid",
        sourceDomain: 26,
        burnTxHash: "0xdead",
        log: (m) => logs.push(m),
        wait: async (ms) => {
          waited += ms;
        },
      }),
      /no attestation after \d+ attempts/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.ok(waited > 0, "should have waited between attempts");
  assert.ok(
    logs.some((l) => l.includes("waiting")),
    "the transcript must show the backoff, since the logs are the evidence"
  );
});

test("stops as soon as the attestation is complete", async () => {
  const logs = [];
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    calls++;
    return {
      status: 200,
      json: async () => ({
        messages: [{ status: calls >= 3 ? "complete" : "pending_confirmations" }],
      }),
    };
  };

  try {
    const msg = await awaitAttestation({
      api: "https://example.invalid",
      sourceDomain: 26,
      burnTxHash: "0xdead",
      log: (m) => logs.push(m),
      wait: async () => {},
    });
    assert.equal(msg.status, "complete");
    assert.equal(calls, 3, "should stop polling the moment it is complete");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

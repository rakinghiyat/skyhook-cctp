// An HTTPS client that survives networks which interfere with the host it needs to reach.
//
// Two distinct kinds of interference have been observed in practice, and they need different
// answers:
//
//   1. DNS hijacking — the resolver answers with a filter's address, which then presents a
//      certificate for the filter rather than the site. TLS verification fails, correctly.
//      Answer: resolve the name over DNS-over-HTTPS, which the network cannot rewrite, and dial
//      that address with the right SNI.
//
//   2. Connection resets — the address is right, but the connection is killed mid-handshake,
//      apparently on the hostname in the TLS ClientHello. Answer: retry. Measured on the network
//      this was developed on, roughly two thirds of attempts get through, so a few retries turn
//      a hard failure into a brief delay.
//
// **Certificate verification stays on in both paths.** Pinned resolution changes which address is
// dialled, never whether the peer is trusted. An attestation authorizes a mint, so accepting one
// from an unverified peer would defeat the entire purpose of checking it — this code must never
// be "fixed" by disabling verification.
import https from "node:https";
import { setTimeout as sleep } from "node:timers/promises";

const DOH = "https://cloudflare-dns.com/dns-query";

/** Transient at the network layer — worth another attempt. */
const RETRYABLE = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

/** The resolver is lying to us — a different address is needed, not another attempt. */
const HIJACKED = new Set([
  "CERT_HAS_EXPIRED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "SELF_SIGNED_CERT_IN_CHAIN",
]);

const codeOf = (err) => err?.cause?.code ?? err?.code;

async function resolveOverDoh(hostname, depth = 0) {
  if (depth > 2) return [];
  const res = await fetch(`${DOH}?name=${encodeURIComponent(hostname)}&type=A`, {
    headers: { accept: "application/dns-json" },
  });
  const body = await res.json();
  const answers = body.Answer ?? [];
  const a = answers.filter((x) => x.type === 1).map((x) => x.data);
  if (a.length) return a;
  const cname = answers.find((x) => x.type === 5)?.data;
  return cname ? resolveOverDoh(cname.replace(/\.$/, ""), depth + 1) : [];
}

function requestTo(ip, url, { method = "GET", timeoutMs = 20000 } = {}) {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: ip,
        servername: u.hostname, // correct SNI …
        rejectUnauthorized: true, // … and the certificate is still checked against it
        path: u.pathname + u.search,
        method,
        headers: { host: u.hostname, accept: "application/json" },
        timeout: timeoutMs,
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", reject);
    req.end();
  });
}

/**
 * Fetches JSON, retrying transient failures and falling back to pinned resolution when the
 * resolver has been tampered with. On a healthy network the first attempt succeeds and none of
 * this machinery runs.
 */
export async function fetchJson(url, { method = "GET", attempts = 5, log = () => {} } = {}) {
  const hostname = new URL(url).hostname;
  let pinned = null;
  let lastErr;

  for (let i = 1; i <= attempts; i++) {
    try {
      if (pinned) {
        for (const ip of pinned) {
          try {
            const { status, body } = await requestTo(ip, url, { method });
            return { status, json: body ? JSON.parse(body) : null };
          } catch (e) {
            lastErr = e;
          }
        }
        throw lastErr;
      }
      const res = await fetch(url, { method });
      return { status: res.status, json: await res.json().catch(() => null) };
    } catch (err) {
      lastErr = err;
      const code = codeOf(err);

      if (HIJACKED.has(code) && !pinned) {
        log(`  ${hostname}: ${code} — the resolver is answering with someone else's address`);
        pinned = await resolveOverDoh(hostname);
        if (!pinned.length) throw new Error(`could not resolve ${hostname} over DoH`);
        log(`  resolved over DoH to ${pinned.join(", ")}; certificate verification stays on`);
        continue; // retry immediately with the real address
      }

      if (!RETRYABLE.has(code) && !HIJACKED.has(code)) {
        throw new Error(`${hostname}: ${err.message}${code ? ` (${code})` : ""}`);
      }

      if (i === attempts) break;
      const wait = 1000 * i;
      log(`  ${hostname}: ${code}, retrying in ${wait}ms (${i}/${attempts})`);
      await sleep(wait);
    }
  }

  const code = codeOf(lastErr);
  throw new Error(
    `${hostname}: gave up after ${attempts} attempts — ${lastErr?.message}` +
      `${code ? ` (${code})` : ""}`
  );
}

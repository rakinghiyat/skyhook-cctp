// An HTTPS client that works on networks that block the host we need.
//
// We've seen two kinds of blocking:
//
//   1. DNS hijacking: the resolver returns a filter's address, and TLS fails (correctly).
//      Fix: resolve over DNS-over-HTTPS and connect to that address with the right SNI.
//
//   2. Connection resets: the address is right, but the handshake gets killed. Fix: retry.
//      About two thirds of attempts got through on the network this was built on.
//
// Certificate checks stay on in both cases. An attestation authorizes a mint, so never "fix"
// this by turning verification off.
import https from "node:https";
import { setTimeout as sleep } from "node:timers/promises";

const DOH = "https://cloudflare-dns.com/dns-query";

/** A temporary network error, worth retrying. */
const RETRYABLE = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

/** The resolver is lying. We need another address, not another attempt. */
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
 * Fetches JSON, retrying temporary failures and switching to DoH when the resolver is tampered
 * with. On a normal network the first attempt just works.
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
        log(`  ${hostname}: ${code}, the resolver is answering with someone else's address`);
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
    `${hostname}: gave up after ${attempts} attempts: ${lastErr?.message}` +
      `${code ? ` (${code})` : ""}`
  );
}

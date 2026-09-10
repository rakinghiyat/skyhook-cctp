// An HTTPS client that survives a network hijacking the DNS for the host it needs.
//
// Some ISPs — the one this was developed on among them — intercept DNS for whole domains and
// answer with their own filter address, which then presents a certificate for the filter rather
// than the site. Ordinary `fetch` fails TLS verification, correctly.
//
// The fix is to resolve the name somewhere the ISP cannot rewrite (DNS-over-HTTPS) and dial that
// address with the right SNI. **Certificate verification stays on.** Pinned resolution changes
// which address we dial; it does not change whether we trust what answers. An attestation is the
// proof that authorizes a mint — accepting one from an unverified peer would defeat its purpose
// entirely, so this never disables verification and must never be made to.
import https from "node:https";
import { setTimeout as sleep } from "node:timers/promises";

const DOH = "https://cloudflare-dns.com/dns-query";

/** Resolves a hostname over DNS-over-HTTPS, following one level of CNAME. */
async function resolveOverDoh(hostname) {
  for (const name of [hostname]) {
    const res = await fetch(`${DOH}?name=${encodeURIComponent(name)}&type=A`, {
      headers: { accept: "application/dns-json" },
    });
    const body = await res.json();
    const answers = body.Answer ?? [];
    const a = answers.filter((x) => x.type === 1).map((x) => x.data);
    if (a.length) return a;
    const cname = answers.find((x) => x.type === 5)?.data;
    if (cname) return resolveOverDoh(cname.replace(/\.$/, ""));
  }
  return [];
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
 * Fetches JSON, falling back to pinned resolution when ordinary DNS has been tampered with.
 * On a normal network the first attempt succeeds and none of this machinery is used.
 */
export async function fetchJson(url, { method = "GET", attempts = 3, log = () => {} } = {}) {
  try {
    const res = await fetch(url, { method });
    return { status: res.status, json: await res.json().catch(() => null) };
  } catch (err) {
    const hijacked =
      err?.cause?.code === "CERT_HAS_EXPIRED" ||
      err?.cause?.code === "ERR_TLS_CERT_ALTNAME_INVALID" ||
      err?.cause?.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE";
    if (!hijacked) throw err;

    const hostname = new URL(url).hostname;
    log(
      `  DNS for ${hostname} appears hijacked (${err.cause.code}); resolving over DoH instead ` +
        `— certificate verification stays on`
    );
    const ips = await resolveOverDoh(hostname);
    if (!ips.length) throw new Error(`could not resolve ${hostname} over DoH`);
    log(`  resolved ${hostname} -> ${ips.join(", ")}`);

    let lastErr;
    for (let i = 0; i < attempts; i++) {
      for (const ip of ips) {
        try {
          const { status, body } = await requestTo(ip, url, { method });
          return { status, json: body ? JSON.parse(body) : null };
        } catch (e) {
          lastErr = e;
        }
      }
      await sleep(1500);
    }
    throw lastErr ?? new Error(`could not reach ${hostname}`);
  }
}

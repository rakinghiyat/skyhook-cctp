"use client";
// The claim page.
//
// SOW D3: "a Freighter-connected page where a recipient claims held funds and signs without
// holding XLM."
//
// The recipient signs; a sponsor pays. Two signatures from two different places, and the split is
// what makes the arrangement safe — the sponsor's envelope cannot alter the transaction it wraps,
// so covering someone's fee grants no authority over their money. The page shows the recipient's
// XLM balance either side of the claim, because the promise is about what they did *not* spend,
// and that is worth demonstrating rather than asserting.
import { useState } from "react";
import { buildClaimTransaction, heldAmount, explainClaimError } from "@skyhook/sdk";
import { CONFIG, formatUsdc } from "@/lib/skyhook";
import { connect, sign, INSTALL_URL } from "@/lib/freighter";

async function xlmBalance(address) {
  try {
    const res = await fetch(`${CONFIG.horizonUrl}/accounts/${address}`);
    if (!res.ok) return null;
    const body = await res.json();
    return body.balances.find((b) => b.asset_type === "native")?.balance ?? null;
  } catch {
    return null;
  }
}

export default function ClaimPage() {
  const [address, setAddress] = useState(null);
  const [held, setHeld] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  async function onConnect() {
    setError(null);
    setBusy(true);
    try {
      const who = await connect();
      setAddress(who);
      setStatus("Checking what is held for you…");
      setHeld(
        await heldAmount({
          rpcUrl: CONFIG.rpcUrl,
          holdId: CONFIG.holdId,
          recipient: who,
          networkPassphrase: CONFIG.networkPassphrase,
        })
      );
      setStatus(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function onClaim() {
    setError(null);
    setBusy(true);
    try {
      const xlmBefore = await xlmBalance(address);

      setStatus("Preparing the transaction…");
      const { xdr } = await buildClaimTransaction({
        rpcUrl: CONFIG.rpcUrl,
        holdId: CONFIG.holdId,
        recipient: address,
        networkPassphrase: CONFIG.networkPassphrase,
      });

      setStatus("Waiting for you to sign in Freighter…");
      const signedXdr = await sign(xdr, {
        networkPassphrase: CONFIG.networkPassphrase,
        networkName: CONFIG.network,
        address,
      });

      setStatus("Asking the sponsor to pay the fee and submit…");
      const res = await fetch("/api/sponsor", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ signedXdr }),
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(
          `${body.error ?? "The sponsor could not be reached"}. Your signature was not used and ` +
            "nothing was submitted; your funds are untouched."
        );
      }

      setStatus(null);
      setResult({ ...body, xlmBefore, xlmAfter: await xlmBalance(address) });
      setHeld(0n);
    } catch (e) {
      setStatus(null);
      setError(explainClaimError(e.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-5 pb-14 pt-32 md:pt-40">
      <h1 className="text-3xl font-semibold tracking-tight">Claim what is held for you</h1>
      <p className="mt-3 text-lg leading-relaxed text-gray-600">
        When USDC arrives for someone who cannot yet receive it, Skyhook holds it rather than
        letting the transfer fail. This is where you collect it — and the fee is paid for you, so
        you need no XLM of your own.
      </p>

      {!address && (
        <button
          onClick={onConnect}
          disabled={busy}
          className="mt-7 rounded-lg bg-linear-to-t from-blue-600 to-blue-500 px-5 py-3 font-medium text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Connecting…" : "Connect Freighter"}
        </button>
      )}

      {address && (
        <section className="mt-7 rounded-xl border border-gray-200 p-5">
          <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-6 gap-y-3">
            <dt className="text-sm text-gray-600">Your address</dt>
            <dd className="break-all font-mono text-sm">{address}</dd>
            <dt className="text-sm text-gray-600">Held for you</dt>
            <dd className="text-2xl font-semibold tracking-tight">
              {held === null ? "…" : `${formatUsdc(held)} USDC`}
            </dd>
          </dl>

          {held === 0n && !result && (
            <p className="mt-4 text-sm text-gray-600">
              Nothing is waiting for this address. That is the ordinary case — funds only appear
              here when a transfer arrived while you could not receive it.
            </p>
          )}

          {held > 0n && (
            <button
              onClick={onClaim}
              disabled={busy}
              className="mt-5 rounded-lg bg-linear-to-t from-blue-600 to-blue-500 px-5 py-3 font-medium text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Working…" : `Claim ${formatUsdc(held)} USDC`}
            </button>
          )}
        </section>
      )}

      {status && (
        <p className="mt-5 flex items-center gap-2 text-sm text-gray-600">
          <span className="size-2 animate-pulse rounded-full bg-linear-to-t from-blue-600 to-blue-500" />
          {status}
        </p>
      )}

      {error && (
        <div className="mt-5 rounded-xl border border-red-300 bg-red-50 p-5">
          <p className="font-medium text-red-700">{error}</p>
          {/not installed/i.test(error) && (
            <p className="mt-3">
              <a href={INSTALL_URL} target="_blank" rel="noreferrer" className="underline">
                Install Freighter →
              </a>
            </p>
          )}
          {/trustline/i.test(error) && (
            <p className="mt-3 text-sm text-gray-600">
              A Stellar account has to opt in to each asset it holds. Add USDC in Freighter, then
              claim again — the held balance stays exactly where it is until you do.
            </p>
          )}
        </div>
      )}

      {result && (
        <div className="mt-5 rounded-xl border border-emerald-300 bg-emerald-50 p-5">
          <h2 className="text-lg font-semibold text-emerald-600">Claimed</h2>
          <dl className="mt-4 grid grid-cols-[auto_1fr] items-baseline gap-x-6 gap-y-3">
            <dt className="text-sm text-gray-600">Transaction</dt>
            <dd>
              <a
                href={CONFIG.explorer(result.hash)}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-sm underline"
              >
                {result.hash.slice(0, 16)}…
              </a>
            </dd>
            <dt className="text-sm text-gray-600">Fee paid by</dt>
            <dd className="font-mono text-sm">{result.feeAccount?.slice(0, 8)}… (the sponsor)</dd>
            <dt className="text-sm text-gray-600">Your XLM</dt>
            <dd>
              {result.xlmBefore === result.xlmAfter ? (
                <>
                  <strong>unchanged</strong> at {result.xlmAfter}
                </>
              ) : (
                <>
                  {result.xlmBefore} → {result.xlmAfter}
                </>
              )}
            </dd>
          </dl>
          <p className="mt-4 text-sm text-gray-600">
            You authorized the transfer; someone else paid for it. The sponsor could not have
            altered where the money went — changing a single byte would have invalidated your
            signature.
          </p>
        </div>
      )}
    </div>
  );
}

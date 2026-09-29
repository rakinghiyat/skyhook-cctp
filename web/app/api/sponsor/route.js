// The sponsor: pays the fee for a claim someone else signed.
//
// A fee bump has to be signed by the account paying, and that key cannot go in the browser where
// anyone can read it. So the page builds and the recipient signs; this route wraps and submits.
//
// It is deliberately incurious about everything except one thing: that what it is being asked to
// pay for is a `claim` on our Hold handler, already signed. Without that check it would be a free
// fee-payer for any transaction anyone cared to send it.
//
// What it does NOT do, by the SOW's own exclusion: key rotation, rate limiting, anti-abuse. It
// holds a single Testnet key. Someone determined could drain it — but only by making genuine CCTP
// transfers to themselves first, which costs them more than it costs us, and friendbot refills
// it. That trade is acceptable on Testnet and would not be on mainnet.
import { feeBumpAndSubmit } from "@skyhook/sdk";

export async function POST(request) {
  const rpcUrl = process.env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";
  const holdId = process.env.HANDLER_HOLD_ID;
  const sponsorSecret = process.env.SPONSOR_SECRET_KEY;

  if (!sponsorSecret || !holdId) {
    // Misconfiguration, not the caller's fault — name which variables so it is fixable.
    return Response.json(
      { error: "No sponsor is configured here (SPONSOR_SECRET_KEY, HANDLER_HOLD_ID)" },
      { status: 503 }
    );
  }

  const { signedXdr } = await request.json().catch(() => ({}));
  if (typeof signedXdr !== "string" || !signedXdr) {
    return Response.json({ error: "expected a signedXdr string" }, { status: 400 });
  }

  try {
    const result = await feeBumpAndSubmit({
      rpcUrl,
      signedXdr,
      sponsorSecret,
      expectedHoldId: holdId,
    });
    return Response.json(result);
  } catch (e) {
    // A refusal here is usually the guard doing its job, so the reason is worth returning rather
    // than flattening into "bad request".
    return Response.json({ error: e.message }, { status: 400 });
  }
}

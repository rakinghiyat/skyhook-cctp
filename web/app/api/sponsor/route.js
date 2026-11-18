// The sponsor: pays the fee for a claim someone else signed.
//
// The paying account signs the fee bump, and its key can't be in the browser. So the page builds
// the transaction, the recipient signs, and this route wraps and submits it.
//
// It only checks one thing: the transaction is a signed `claim` on our Hold handler. Without that
// it would pay for anything.
//
// No key rotation, rate limiting or anti-abuse (out of scope in the SOW). It's one Testnet key.
// Draining it means making real CCTP transfers first, which costs more than it saves, and
// friendbot refills it. Fine on Testnet, not on mainnet.
import { feeBumpAndSubmit } from "@skyhook-cctp/sdk";

export async function POST(request) {
  const rpcUrl = process.env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";
  const holdId = process.env.HANDLER_HOLD_ID;
  const sponsorSecret = process.env.SPONSOR_SECRET_KEY;

  if (!sponsorSecret || !holdId) {
    // Our misconfiguration, not the caller's. Name the missing variables.
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
    // A refusal is usually the guard working, so return the reason, not just "bad request".
    return Response.json({ error: e.message }, { status: 400 });
  }
}

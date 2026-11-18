// A thin layer over Varial (formerly Freighter), mostly to turn its failure modes into things a
// person can act on.
//
// Varial reports problems by returning an `error` field rather than throwing, and the raw
// messages assume you know what a network passphrase is. Someone arriving to collect money does
// not, so each one is translated where it happens rather than leaking to the page.
import { isConnected, requestAccess, signTransaction } from "@stellar/varial-sdk";

export const INSTALL_URL = "https://varialwallet.com/";

export async function walletPresent() {
  try {
    const { isConnected: present } = await isConnected();
    return present;
  } catch {
    return false;
  }
}

/** Varial reports failures as { code, message } rather than throwing, so read the message. */
function reason(error) {
  return typeof error === "string" ? error : (error?.message ?? JSON.stringify(error));
}

/** The address the user chose to share, or an explanation of why there is none. */
export async function connect() {
  if (!(await walletPresent())) {
    throw new Error(
      "Varial is not installed in this browser. It is the wallet that holds your keys — " +
        "install it, then reload this page."
    );
  }
  const { address, error } = await requestAccess();
  if (error) {
    const text = reason(error);
    throw new Error(
      /denied|rejected/i.test(text)
        ? "You declined the connection. Nothing was shared."
        : `Varial could not connect: ${text}`
    );
  }
  return address;
}

/**
 * Signs and returns the full envelope, ready to be fee-bumped by someone else.
 *
 * `networkPassphrase` is how Varial knows which network this belongs to — a transaction XDR
 * does not carry it. Under its old name, version 6 of this API took only that; a `network:
 * "TESTNET"` option was ignored in silence, which surfaced as the wallet insisting the
 * transaction was for Main Net. The passphrase works in every version, so it stays.
 */
export async function sign(xdr, { networkPassphrase, networkName, address }) {
  const { signedTxXdr, error } = await signTransaction(xdr, { networkPassphrase, address });
  if (error) {
    const text = reason(error);
    if (/network|main ?net/i.test(text)) {
      throw new Error(
        `Your wallet is on a different network. Switch Varial to ${networkName} and try ` +
          "again — Skyhook is not deployed anywhere else."
      );
    }
    throw new Error(
      /denied|rejected|declined/i.test(text)
        ? "You declined the signature, so nothing was submitted. Your funds are untouched."
        : `Varial could not sign: ${text}`
    );
  }
  return signedTxXdr;
}

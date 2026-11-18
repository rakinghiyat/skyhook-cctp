// A thin layer over Varial (formerly Freighter) that turns its errors into messages people can
// act on. Varial returns an `error` field instead of throwing, and its raw messages assume you
// know what a network passphrase is.
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
      "Varial is not installed in this browser. It is the wallet that holds your keys. " +
        "Install it, then reload this page."
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
 * Signs and returns the full envelope, ready for someone else to fee-bump.
 *
 * Pass `networkPassphrase`, since the XDR doesn't say which network it's for. The package
 * ignores a `network: "TESTNET"` option without warning, and the wallet then assumes Main Net.
 */
export async function sign(xdr, { networkPassphrase, networkName, address }) {
  const { signedTxXdr, error } = await signTransaction(xdr, { networkPassphrase, address });
  if (error) {
    const text = reason(error);
    if (/network|main ?net/i.test(text)) {
      throw new Error(
        `Your wallet is on a different network. Switch Varial to ${networkName} and try ` +
          "again. Skyhook is not deployed anywhere else."
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

// Where Skyhook lives. These Testnet addresses aren't secret; they're in the README. The only
// secret is the sponsor's key, which stays in the /api route.
export const CONFIG = {
  network: "TESTNET",
  networkPassphrase: "Test SDF Network ; September 2015",
  rpcUrl: "https://soroban-testnet.stellar.org",
  horizonUrl: "https://horizon-testnet.stellar.org",

  coreId: "CCOMST7FEDLYJ5MXZTVKVKMK43AQP2U2AZEZRHE3XHYO6UF6LKC2654F",
  holdId: "CCLVTDVGYHSWFC7AW2L327WMFZVKZDFYY24G7Z4IZO2SQDM4DVWE7TC6",
  depositId: "CBZOKXZKKORG4FI5URPJMX3XHBDU6E7EXPD4YY36R36PHVOMEKWXRVFY",
  vaultId: "CAY6UNOOWATJW2LXFGMTO6NKLJRVWRKMNVZVPGLKRBLE5Y6OFMDF7IB4",

  repoUrl: "https://github.com/rakinghiyat/skyhook-cctp",
  explorer: (hash) => `https://stellar.expert/explorer/testnet/tx/${hash}`,
  contractUrl: (id) => `https://stellar.expert/explorer/testnet/contract/${id}`,
};

/** Stellar amounts have 7 decimals. Format them for people. */
export function formatUsdc(raw) {
  const n = BigInt(raw);
  const whole = n / 10_000_000n;
  const frac = (n % 10_000_000n).toString().padStart(7, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

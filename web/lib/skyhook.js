// Where Skyhook lives. Testnet contract addresses, not secrets — they are printed in the README
// and resolve on stellar.expert. The sponsor's key is the only secret involved, and it stays in
// the server route under /api.
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

/** Stellar amounts carry 7 decimals; show them as people read them. */
export function formatUsdc(raw) {
  const n = BigInt(raw);
  const whole = n / 10_000_000n;
  const frac = (n % 10_000_000n).toString().padStart(7, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

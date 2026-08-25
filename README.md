<div align="center">
  <h1>Skyhook</h1>
  <p>The execution layer for <a href="https://developers.circle.com/cctp">CCTP</a> hooks on <a href="https://stellar.org">Stellar</a> — so USDC does something the moment it lands.</p>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache-E38B40.svg" alt="License"></a>
  <img src="https://img.shields.io/badge/Soroban-Rust-858585.svg" alt="Soroban / Rust">
  <img src="https://img.shields.io/badge/SDK-TypeScript-3178c6.svg" alt="TypeScript">
  <img src="https://img.shields.io/badge/network-Stellar%20Testnet-7093B5.svg" alt="Stellar Testnet">
  <img src="https://img.shields.io/badge/status-in%20development-f59e0b.svg" alt="Status">
</div>

---

## What this is

Circle's CCTP moves native USDC to Stellar, but it does not execute hooks — by design. Inside
`mint_and_forward`, `CctpForwarder` **transfers** the minted USDC to the recipient; it never
invokes it. Soroban has no receive callback in its token interface, so a contract named as the
recipient is credited and never called.

Circle's hook format nevertheless reserves a trailing field for an integrator-defined payload.
No contract on Stellar reads it today.

Skyhook reads that field and executes the instruction inside it. Arriving USDC can deposit
itself into a SEP-56 vault on arrival, or rest safely on-chain when the recipient is not yet
able to receive — instead of the whole transfer reverting.

## Built with

[Rust](https://www.rust-lang.org) and [soroban-sdk](https://developers.stellar.org/docs/build/smart-contracts) ·
[OpenZeppelin Stellar Contracts](https://developers.stellar.org/docs/tools/openzeppelin-contracts) ·
[TypeScript](https://www.typescriptlang.org) ·
[Freighter](https://www.freighter.app) ·
[Circle CCTP](https://developers.circle.com/cctp)

## License

[Apache-2.0](LICENSE)

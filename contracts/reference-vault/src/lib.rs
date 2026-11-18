#![no_std]
// `MuxedAddress` looks unused here, but the `contracttrait` macro expands the library's
// default trait methods into this scope and some of them mention it.
use soroban_sdk::{contract, contractimpl, Address, Env, MuxedAddress, String};
use stellar_tokens::{
    fungible::{Base, FungibleToken},
    vault::{FungibleVault, Vault},
};

// The reference SEP-56 vault for testing and demoing the Deposit handler.
//
// A thin wrapper over OpenZeppelin's audited `Vault`. All the vault logic comes from the
// library; this file only wires it up. We deploy our own so the demo doesn't depend on someone
// else's vault staying up.
//
// The Deposit handler doesn't depend on this contract. Any SEP-56 vault works.

#[contract]
pub struct ReferenceVault;

#[contractimpl]
impl ReferenceVault {
    pub fn __constructor(e: &Env, name: String, symbol: String, asset: Address, decimals_offset: u32) {
        Vault::set_asset(e, asset);
        Vault::set_decimals_offset(e, decimals_offset);
        Base::set_metadata(e, Self::decimals(e), name, symbol);
    }
}

#[contractimpl(contracttrait)]
impl FungibleToken for ReferenceVault {
    type ContractType = Vault;

    fn decimals(e: &Env) -> u32 {
        Vault::decimals(e)
    }
}

#[contractimpl(contracttrait)]
impl FungibleVault for ReferenceVault {}

#![no_std]
// `MuxedAddress` looks unused here, but the `contracttrait` macro expands the library's
// default trait methods into this scope and some of them mention it.
use soroban_sdk::{contract, contractimpl, Address, Env, MuxedAddress, String};
use stellar_tokens::{
    fungible::{Base, FungibleToken},
    vault::{FungibleVault, Vault},
};

// The reference SEP-56 vault used to demonstrate and test the Deposit handler.
//
// Deliberately a thin wrapper over OpenZeppelin's audited `Vault` — the point of naming
// OpenZeppelin is to use their implementation, not to reimplement it. Everything here is
// wiring; the vault mechanics come from the library.
//
// Self-deployed so Deliverable 2 depends on nothing external: a third-party vault that went
// down or was redeployed mid-sprint would break the deliverable through no fault of ours.
//
// Note what this is *not*: the Deposit handler targets the SEP-56 interface, never this
// contract. Any conforming vault works, and its address travels in the instruction.

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

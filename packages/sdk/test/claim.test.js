import test from "node:test";
import assert from "node:assert/strict";
import {
  Account,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  Contract,
  Address,
  nativeToScVal,
  Operation,
  Asset,
} from "@stellar/stellar-sdk";
import { assertIsClaimOn, explainClaimError } from "../src/index.js";

// A sponsor endpoint that fee-bumps whatever it is handed is a free fee-payer for the whole
// network. These tests pin the guard that stops that, and they are built offline so they check
// the logic rather than the state of a testnet.
const HOLD = "CCLVTDVGYHSWFC7AW2L327WMFZVKZDFYY24G7Z4IZO2SQDM4DVWE7TC6";
const OTHER = "CCOMST7FEDLYJ5MXZTVKVKMK43AQP2U2AZEZRHE3XHYO6UF6LKC2654F";
const WHO = "GAQBGO4CX33NSYXHGMVRAMPQVC427H7LQFOCTTOZNBEQOB5LC5GKX3JF";

function txCalling(contractId, fnName) {
  return new TransactionBuilder(new Account(WHO, "1"), {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      new Contract(contractId).call(
        fnName,
        nativeToScVal(Address.fromString(WHO), { type: "address" })
      )
    )
    .setTimeout(300)
    .build();
}

test("accepts a claim on the expected Hold handler", () => {
  assert.doesNotThrow(() => assertIsClaimOn(txCalling(HOLD, "claim"), HOLD));
});

test("refuses a claim aimed at a different contract", () => {
  // The dangerous shape: a well-formed `claim`, just not ours.
  assert.throws(() => assertIsClaimOn(txCalling(OTHER, "claim"), HOLD), /not the Hold handler/);
});

test("refuses a different function on the right contract", () => {
  assert.throws(() => assertIsClaimOn(txCalling(HOLD, "claim_to"), HOLD), /not claim/);
});

test("refuses a plain payment", () => {
  const tx = new TransactionBuilder(new Account(WHO, "1"), {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.payment({ destination: WHO, asset: Asset.native(), amount: "1" }))
    .setTimeout(300)
    .build();
  assert.throws(() => assertIsClaimOn(tx, HOLD), /expected a contract invocation/);
});

test("refuses a transaction carrying more than one operation", () => {
  // Otherwise a real claim could be smuggled alongside anything else, and the sponsor would
  // pay for both.
  const tx = new TransactionBuilder(new Account(WHO, "1"), {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.payment({ destination: WHO, asset: Asset.native(), amount: "1" }))
    .addOperation(Operation.payment({ destination: WHO, asset: Asset.native(), amount: "2" }))
    .setTimeout(300)
    .build();
  assert.throws(() => assertIsClaimOn(tx, HOLD), /expected one operation/);
});

test("names the failures a recipient will actually hit", () => {
  assert.match(explainClaimError("HostError: Error(Contract, #13)"), /trustline/i);
  assert.match(explainClaimError("HostError: Error(Contract, #6908)"), /already claimed/i);
  // Anything unrecognised is passed through rather than mislabelled.
  assert.equal(explainClaimError("something else entirely"), "something else entirely");
});

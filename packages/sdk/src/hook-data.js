// Builds Circle's CCTP hook data frame for Stellar, per docs/SPEC.md §1:
//   bytes  0-23   magic — zero
//   bytes 24-27   version (uint32 BE) — 0
//   bytes 28-31   L — byte length of forwardRecipient (uint32 BE)
//   bytes 32..    forwardRecipient as a Stellar strkey (UTF-8)
//   bytes 32+L..  optional integrator-defined payload (omitted for the gate baseline test)
export function buildHookData(forwardRecipientStrkey, extraPayload = new Uint8Array(0)) {
  const recipientBytes = new TextEncoder().encode(forwardRecipientStrkey);
  const L = recipientBytes.length;

  const buf = new Uint8Array(32 + L + extraPayload.length);
  // bytes 0-23 stay zero (magic)
  const view = new DataView(buf.buffer);
  view.setUint32(24, 0); // version
  view.setUint32(28, L); // length of forwardRecipient
  buf.set(recipientBytes, 32);
  buf.set(extraPayload, 32 + L);

  return buf;
}

export function toHex(bytes) {
  return "0x" + Buffer.from(bytes).toString("hex");
}

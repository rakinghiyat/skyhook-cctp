// Builds a Skyhook instruction envelope (docs/SPEC.md §2).
//
//   offset  size  field
//   0       1     version            0x01
//   1       56    fallback_recipient Stellar strkey, ASCII
//   57      4     handler_id         u32 BE
//   61      2     params_len         u16 BE
//   63      var   params
const VERSION = 0x01;
const STRKEY_LEN = 56;

/// Deposit's params are just the vault address, as a 56-byte strkey (docs/SPEC.md §3).
export function depositParams(vaultStrkey) {
  const bytes = new TextEncoder().encode(vaultStrkey);
  if (bytes.length !== STRKEY_LEN) {
    throw new Error(`vault must be a ${STRKEY_LEN}-byte strkey, got ${bytes.length}`);
  }
  return bytes;
}

export function buildInstruction(fallbackRecipientStrkey, handlerId, params = new Uint8Array(0)) {
  const recipient = new TextEncoder().encode(fallbackRecipientStrkey);
  if (recipient.length !== STRKEY_LEN) {
    throw new Error(`fallback_recipient must be a ${STRKEY_LEN}-byte strkey, got ${recipient.length}`);
  }

  const buf = new Uint8Array(63 + params.length);
  const view = new DataView(buf.buffer);
  buf[0] = VERSION;
  buf.set(recipient, 1);
  view.setUint32(57, handlerId);
  view.setUint16(61, params.length);
  buf.set(params, 63);
  return buf;
}

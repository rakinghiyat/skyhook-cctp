// The colour the page sits on.
//
// One element with layered gradients, not separate blurred circles. Separate blobs read as a
// pattern; one background blends into a single field, like circle.com/cross-chain-transfer-protocol.
// It has no colour at the top and gathers toward the bottom.
//
// The layers:
//
//   1. a wide radial of green, low and to the left
//   2. a wide radial of blue, low and to the right, reaching highest of the three
//   3. a second blue anchoring the bottom-right corner
//   4. a vertical wash underneath all of them
//
// The wash is transparent for its first 28%, which lands just below the hero, so the first
// screen stays clean.
//
// The centres sit at 84%, 68% and 90%, not lower. Lower put the strongest colour behind the
// white footer, where nobody saw it.
//
// Green needs a second source in the bottom-left, like blue has on the right. Moving one source
// up to reach higher also pulls it off the bottom, and blue then fills the foot of the page.
export default function PageGlow() {
  return (
    <div
      className="pointer-events-none absolute inset-0 -z-10"
      aria-hidden="true"
      style={{
        backgroundImage: [
          'radial-gradient(64rem 54rem at 4% 76%, rgba(16, 185, 129, 0.18), transparent 68%)',
          'radial-gradient(58rem 46rem at 2% 97%, rgba(16, 185, 129, 0.19), transparent 66%)',
          'radial-gradient(88rem 76rem at 97% 66%, rgba(59, 130, 246, 0.28), transparent 72%)',
          'radial-gradient(66rem 52rem at 86% 90%, rgba(59, 130, 246, 0.21), transparent 68%)',
          'linear-gradient(to bottom, rgba(99, 132, 220, 0) 0%, rgba(99, 132, 220, 0) 28%, rgba(99, 132, 220, 0.05) 62%, rgba(99, 132, 220, 0.13) 100%)',
        ].join(', '),
      }}
    />
  );
}

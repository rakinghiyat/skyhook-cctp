// The colour the page sits on.
//
// An earlier version stacked eight blurred circles down the two edges. That was the wrong shape
// for the job: discrete blobs read as a pattern, and a pattern repeats. What the reference does
// — circle.com/cross-chain-transfer-protocol — is one continuous field that simply is not there
// at the top and has gathered by the bottom. No edges, nothing to count.
//
// So this is a single element carrying layered gradients instead:
//
//   1. a wide radial of green, low and to the left
//   2. a wide radial of blue, low and to the right, reaching highest of the three
//   3. a second blue anchoring the bottom-right corner
//   4. a vertical wash underneath all of them
//
// Because they are painted as one background rather than as separate elements, they blend into
// each other and no individual source is visible.
//
// **The top of the page carries no colour at all.** The wash is transparent for its first 28%,
// which on this page lands just below the hero — a wash that starts at zero still tints the
// hero, because zero is where it begins, not where it becomes visible. So the first screen is
// clean and colour arrives with the second section.
//
// **The centres stop short of the bottom edge.** They were at 91%, 72% and 99%, which put the
// densest part of the field behind the footer — and the footer is plain white, so the strongest
// colour on the page was painted where nothing could show it. 84%, 68% and 90% put it in the
// last content section instead, where it is actually seen.
//
// **Green needs two sources, for the same reason blue does.** One radial has one centre, and
// raising that centre to carry green further up the page necessarily pulls it off the bottom —
// the foot of the page then fills with blue, whose own reach is wide enough to cross the whole
// width. So there is a second green anchoring the bottom-left corner, mirroring what blue's
// second source does on the right. Moving a single source up and expecting it to stay down is
// the mistake to avoid here.
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

// The guarantees, on the layout Circle uses for "How CCTP works": a small eyebrow, one large
// left-aligned headline, then plain columns — icon above, bold title, body. No cards, no rules,
// no boxes. The simplicity is the point; the previous version set the icon inline beside the
// title, which made each item read as a label rather than as a claim worth stopping on.
//
// Icons are outline rather than filled, and dark rather than brand blue — again Circle's
// treatment. Six identical ticks would carry no information, so each is drawn for what it says.
//
// The content is the fallback ladder, because that is the claim the project has to defend — not
// "it is fast" but "your money does not disappear when something goes wrong".
const FEATURES = [
  {
    title: 'Executed on arrival',
    icon: (
      <>
        <path d="M12 3v9.5m0 0 3.5-3.5M12 12.5 8.5 9" />
        <path d="M3.5 14v5.5a1.5 1.5 0 0 0 1.5 1.5h14a1.5 1.5 0 0 0 1.5-1.5V14" />
      </>
    ),
    body: 'A Deposit instruction places the USDC into a SEP-56 vault in the same transaction that delivers it. No second step, and no USDC trustline — vault shares live in the vault.',
  },
  {
    title: 'Held, not bounced',
    icon: (
      <>
        <circle cx="12" cy="12" r="8.75" />
        <path d="M12 6.75v5.5l3.5 2" />
      </>
    ),
    body: 'A recipient who cannot yet receive would normally make the whole transfer fail. The funds route to Hold instead and stay claimable, with the fee paid by a sponsor.',
  },
  {
    title: 'Recorded, never lost',
    icon: (
      <>
        <path d="M5.5 3h8L19 8.5V20a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
        <path d="M13.25 3.25V8.75H18.75" />
        <path d="M8 13.5h7.5M8 17h4.5" />
      </>
    ),
    body: 'If Hold fails too, the funds stay in the contract marked unresolved. That last step performs no transfer and no external call — only a storage write, so it cannot fail.',
  },
  {
    title: 'The sender chooses',
    icon: (
      <>
        <path d="M3 12h6.5" />
        <path d="M9.5 12 17 4.5M17 4.5h-4.5M17 4.5V9" />
        <path d="M9.5 12 17 19.5M17 19.5h-4.5M17 19.5V15" />
      </>
    ),
    body: 'The registry is permissionless and append-only. An instruction names its own handler, and an id once bound can never be pointed somewhere else.',
  },
  {
    title: 'No privileged party',
    icon: (
      <>
        <rect x="4" y="10.25" width="13" height="10.5" rx="1.75" />
        <path d="M8.5 10.25V6.5a4 4 0 0 1 7.75-1.4" />
      </>
    ),
    body: 'No admin key, no whitelist, no upgrade path. Skyhook adds nobody to trust, and inherits exactly the trust the CCTP deployment already requires.',
  },
  {
    title: 'Anyone can relay',
    icon: (
      <>
        <circle cx="12" cy="12" r="2.4" />
        <path d="M7.75 7.75a6 6 0 0 0 0 8.5M16.25 16.25a6 6 0 0 0 0-8.5" />
        <path d="M4.6 4.6a10.5 10.5 0 0 0 0 14.8M19.4 19.4a10.5 10.5 0 0 0 0-14.8" />
      </>
    ),
    body: 'The relayer holds no funds and takes no custody; it pays for one invocation. Run your own, or rely on someone else running theirs.',
  },
];

export default function Guarantees() {
  return (
    <section className="relative">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="py-16 md:py-24">
          <div
            className="mb-4 text-center text-sm font-semibold uppercase tracking-[0.18em] text-gray-500"
            data-aos="zoom-y-out"
          >
            How Skyhook works
          </div>
          <h2
            className="mx-auto mb-12 max-w-5xl text-center text-4xl font-bold tracking-tight text-gray-900 md:mb-16 md:text-5xl lg:text-6xl"
            data-aos="zoom-y-out"
            data-aos-delay={100}
          >
            Minted funds are never lost, and never cause the transfer to revert
          </h2>

          <div className="grid gap-x-10 gap-y-14 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => (
              <article key={f.title} data-aos="zoom-y-out" data-aos-delay={100 + (i % 3) * 100}>
                <svg
                  className="mb-5 stroke-gray-900"
                  xmlns="http://www.w3.org/2000/svg"
                  width={30}
                  height={30}
                  viewBox="0 0 24 24"
                  fill="none"
                  strokeWidth={1.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  {f.icon}
                </svg>
                <h3 className="mb-3 text-[17px] font-bold text-gray-900">{f.title}</h3>
                <p className="text-[17px] leading-relaxed text-gray-600">{f.body}</p>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

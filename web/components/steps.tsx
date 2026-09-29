import Image from 'next/image';

// The flow: a wallet on some EVM chain, Circle's CCTP, Skyhook, a vault.
//
// The first three nodes are not our work — they are what Circle already ships, and until now the
// chain stopped at the third. Node four only happens because something reads the payload the
// forwarder leaves behind. So the diagram is drawn to make node three the emphasis: it alone
// carries the spinning ring the template puts on its centrepiece.
//
// **One grid, not two rows.** An earlier version put the discs in a flex row and the words in a
// separate four-column grid below, which cannot line up: the connectors take flex space between
// the discs, so a disc never sits above its own column. Here each node is one cell holding disc
// and words together, and the connector is absolutely positioned across the gap between cells —
// so the alignment is structural rather than something to be tuned.
//
// The connector reaches from `50% + 4.25rem` to `-50% + 4.25rem`: half a cell plus clearance, out
// to the same point measured back from the next cell's centre. 4.25rem because the Skyhook node's
// ring sits at `inset: -0.75rem` outside a `size-24` disc, ending at 3.75rem, and the line has to
// start clear of it.

type Node = {
  key: string;
  title: string;
  body: string;
  logos: { src: string; alt: string; className?: string }[];
  ours?: boolean;
};

const NODES: Node[] = [
  {
    key: 'wallet',
    title: 'Wallet on another chain',
    body: 'Someone burns USDC through CCTP. Every transfer recorded in this project came from Arc Testnet; CCTP supports the rest, and Skyhook never asks which chain a message came from.',
    logos: [{ src: '/chains/ethereum.svg', alt: 'Ethereum' }],
  },
  {
    key: 'cctp',
    title: 'Circle CCTP',
    body: 'Burns on the source chain, attests, and mints native USDC on Stellar. This is where it has always stopped — the forwarder credits the recipient and never invokes it.',
    logos: [{ src: '/chains/circle.svg', alt: 'Circle' }],
  },
  {
    key: 'skyhook',
    title: 'Skyhook',
    body: 'Reads the instruction Circle leaves in the trailing payload and runs it, inside the same transaction that delivered the funds. This is the piece that did not exist.',
    logos: [{ src: '/logo-mark.png', alt: 'Skyhook', className: 'h-10 w-auto' }],
    ours: true,
  },
  {
    key: 'vault',
    title: 'SEP-56 vault',
    body: 'A vault deployed on Stellar, holding the position the recipient now owns. The USDC arrives already deposited, and the address travels in the instruction, so any conforming vault works.',
    logos: [{ src: '/chains/stellar.svg', alt: 'Stellar' }],
  },
];

function Disc({ node }: { node: Node }) {
  const inner = (
    <div className="animate-[breath_8s_ease-in-out_infinite_both]">
      <div className="flex size-20 items-center justify-center gap-1.5 rounded-full bg-white shadow-lg shadow-black/[0.03] before:absolute before:inset-0 before:m-[8.334%] before:rounded-[inherit] before:border before:border-gray-700/5 before:bg-gray-200/60 before:[mask-image:linear-gradient(to_bottom,black,transparent)] md:size-24">
        {node.logos.map((l) => (
          <Image
            key={l.src}
            className={`relative ${l.className ?? 'size-7 md:size-8'}`}
            src={l.src}
            alt={l.alt}
            width={40}
            height={40}
          />
        ))}
      </div>
    </div>
  );

  // Only Skyhook gets the ring. The others are infrastructure that already existed.
  return node.ours ? (
    <div className="ring-spin relative">{inner}</div>
  ) : (
    <div className="relative">{inner}</div>
  );
}

/** The connector: a hairline with one highlight sweeping left to right, and an arrowhead. */
function Connector({ delay }: { delay: string }) {
  return (
    <div
      className="absolute top-12 hidden h-px md:block"
      style={{ left: 'calc(50% + 4.25rem)', right: 'calc(-50% + 4.25rem)' }}
      aria-hidden="true"
    >
      {/* Clipped, so the highlight enters and leaves at the ends of the line rather than
          drifting across the discs on either side. */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute inset-0 bg-gray-200" />
        <div
          className="absolute inset-y-0 w-16 bg-linear-to-r from-transparent via-blue-500 to-transparent"
          style={{ animation: `sweep 4s linear ${delay} infinite both` }}
        />
      </div>
      <svg
        className="absolute -right-px -top-[3px] fill-gray-300"
        width={7}
        height={7}
        viewBox="0 0 7 7"
      >
        <path d="M0 0l7 3.5L0 7z" />
      </svg>
    </div>
  );
}

export default function Steps() {
  return (
    <section>
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="pb-24 pt-2.5 md:pb-40">
          <div className="mx-auto max-w-3xl pb-12 text-center md:pb-16">
            <div
              className="mb-4 text-sm font-semibold uppercase tracking-[0.18em] text-gray-500"
              data-aos="zoom-y-out"
            >
              How it works
            </div>
            <h2
              className="mb-4 text-3xl font-bold text-gray-900 md:text-4xl"
              data-aos="zoom-y-out"
              data-aos-delay={100}
            >
              Everything here existed except one link
            </h2>
            <p className="text-lg text-gray-700" data-aos="zoom-y-out" data-aos-delay={150}>
              Circle already carries USDC to Stellar. What it does not do is run the instruction a
              sender attaches — so the money arrives, and then nothing happens. Skyhook is that
              missing step.
            </p>
          </div>

          <div
            className="mx-auto grid max-w-4xl gap-y-12 sm:grid-cols-2 md:grid-cols-4 md:gap-y-0"
            data-aos="zoom-y-out"
            data-aos-delay={300}
          >
            {NODES.map((node, i) => (
              <div key={node.key} className="relative flex flex-col items-center px-2">
                <Disc node={node} />
                {i < NODES.length - 1 && <Connector delay={`${i}s`} />}
                <h3
                  className={`mb-1.5 mt-7 text-center text-sm font-medium ${
                    node.ours ? 'text-blue-600' : 'text-gray-900'
                  }`}
                >
                  {node.title}
                </h3>
                <p className="self-stretch text-left text-[15px] text-gray-600">{node.body}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

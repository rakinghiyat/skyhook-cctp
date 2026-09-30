import { Fragment } from 'react';

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
// **Plain `<img>`, not `next/image`.** Three of these four marks are SVG, and Next's optimizer
// refuses SVG outright — `/_next/image` answers `INVALID_IMAGE_OPTIMIZE_REQUEST`, so they render
// as nothing. `next dev` serves them directly and never hits that path, so this only appeared
// once the site was deployed. The flag that would allow it is called `dangerouslyAllowSVG`, and
// there is nothing to gain by setting it: an SVG is already vector, so resampling it to 48px
// saves nothing. The lockup, wordmark and stripes are plain `<img>` for the same reason.
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
          <img
            key={l.src}
            className={`relative ${l.className ?? 'size-7 md:size-8'}`}
            src={l.src}
            alt={l.alt}
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

/** The connector, wide layout: a hairline with one highlight sweeping left to right. */
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
          style={{ animation: `sweep 2.8s linear ${delay} infinite both` }}
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

/**
 * The rail, phone layout: **one** line for the whole flow, behind every disc.
 *
 * It was one rail per row before, each with its own animation and a delay to hand the light on.
 * That cannot be made smooth. The rows are as tall as their text and the texts differ, so equal
 * durations over unequal distances meant the light changed speed at every junction — and the
 * opacity steps dimmed it at one rail's end before lighting it at the next's, so the two fades
 * ran in sequence and left a dark gap. What looked like a break was a break.
 *
 * Grid row placement removes the junctions rather than tuning them: the rail is one element in
 * column 1 spanning every row, so the highlight makes a single uninterrupted pass at a constant
 * speed. Nothing to hand off, nothing to synchronise.
 */
function Rail({ rows }: { rows: number }) {
  // Where the first and last disc sit, as a fraction of the whole grid. Exact only because the
  // grid is `grid-auto-rows: 1fr`, which makes every row the height of the tallest — so disc n's
  // centre is always at (2n+1)/2rows, whatever the text does. A hard stop rather than a fade:
  // the cut lands dead centre of a disc, and the disc's own white fill hides it.
  const stop = `${100 / (2 * rows)}%`;
  const mask =
    `linear-gradient(to bottom, transparent ${stop}, #000 ${stop}, ` +
    `#000 calc(100% - ${stop}), transparent calc(100% - ${stop}))`;

  return (
    <div
      className="relative col-start-1 w-px justify-self-center overflow-hidden"
      style={{
        gridRowStart: 1,
        gridRowEnd: rows + 1,
        WebkitMaskImage: mask,
        maskImage: mask,
      }}
      aria-hidden="true"
    >
      <div className="absolute inset-0 bg-gray-200" />
      <div
        className="absolute inset-x-0 h-16 bg-linear-to-b from-transparent via-blue-500 to-transparent"
        style={{ animation: 'rail-sweep 2.8s linear infinite both' }}
      />
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

          {/* Phone: the flow runs top to bottom, discs in a column on the left and the words
              beside them, so the arrows survive instead of the four nodes stacking into a list
              with nothing joining them.

              One grid rather than a grid of grids — the rail has to span every row, and grid
              row placement is what lets a single element do that. The rows carry no `gap-y`;
              the spacing lives in the text's `py`, or the rail would show through the gaps. */}
          <div
            className="grid grid-cols-[auto_1fr] gap-x-5 [grid-auto-rows:1fr] md:hidden"
            data-aos="zoom-y-out"
            data-aos-delay={300}
          >
            <Rail rows={NODES.length} />
            {NODES.map((node, i) => (
              <Fragment key={node.key}>
                {/* `items-center` puts the disc level with the middle of its own text. */}
                <div
                  className="relative col-start-1 flex w-20 items-center justify-center"
                  style={{ gridRow: i + 1 }}
                >
                  <Disc node={node} />
                </div>
                <div className="col-start-2 flex flex-col justify-center py-5" style={{ gridRow: i + 1 }}>
                  <h3
                    className={`mb-1.5 text-sm font-medium ${
                      node.ours ? 'text-blue-600' : 'text-gray-900'
                    }`}
                  >
                    {node.title}
                  </h3>
                  <p className="text-[15px] text-gray-600">{node.body}</p>
                </div>
              </Fragment>
            ))}
          </div>

          {/* Tablet and up: the original row. */}
          <div
            className="mx-auto hidden max-w-4xl md:grid md:grid-cols-4"
            data-aos="zoom-y-out"
            data-aos-delay={300}
          >
            {NODES.map((node, i) => (
              <div key={node.key} className="relative flex flex-col items-center px-2">
                <Disc node={node} />
                {i < NODES.length - 1 && <Connector delay={`${i * 0.7}s`} />}
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

import Link from 'next/link';
import FooterLogo from './footer-logo';

// The template's footer, on its twelve-column grid with the gradient hairline above it.
// Columns named for what a reader is looking for, not for how the repository is arranged.
const REPO = 'https://github.com/rakinghiyat/skyhook-cctp';

export default function Footer({ border = false }: { border?: boolean }) {
  return (
    // The footer opts out of the page glow: `relative` puts it above the `-z-10` gradient and
    // `bg-white` covers it, so the colour running down the page stops cleanly at this edge.
    <footer className="relative bg-white">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div
          className={`grid grid-cols-2 gap-x-6 gap-y-8 pb-5 pt-8 sm:grid-cols-12 sm:gap-10 md:pb-6 md:pt-12 ${
            border
              ? 'border-t [border-image:linear-gradient(to_right,transparent,var(--color-slate-200),transparent)1]'
              : ''
          }`}
        >
          {/* 1st block */}
          <div className="col-span-2 space-y-2 sm:col-span-12 lg:col-span-6">
            <div>
              <FooterLogo />
            </div>
            <div className="text-sm text-gray-600">
              The execution layer for CCTP hooks on Stellar.
            </div>
          </div>

          {/* Both link columns in one cell: centred on a phone, pushed to the right edge and
              tightened from `lg`, where they line up over the end of the bottom line. */}
          <div className="col-span-2 flex justify-center gap-x-[86px] sm:col-span-12 lg:col-span-6 lg:justify-end lg:pr-5">
            {/* 3rd block */}
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Protocol</h3>
              <ul className="space-y-2 text-sm">
                <li>
                  <Link
                    className="text-gray-600 transition hover:text-gray-900"
                    href="/docs#instruction-format"
                  >
                    Instruction format
                  </Link>
                </li>
                <li>
                  <Link className="text-gray-600 transition hover:text-gray-900" href="/claim">
                    Claim held funds
                  </Link>
                </li>
                <li>
                  <a
                    className="text-gray-600 transition hover:text-gray-900"
                    href="https://stellar.expert/explorer/testnet/contract/CCOMST7FEDLYJ5MXZTVKVKMK43AQP2U2AZEZRHE3XHYO6UF6LKC2654F"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Contracts
                  </a>
                </li>
              </ul>
            </div>

            {/* 4th block */}
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Project</h3>
              <ul className="space-y-2 text-sm">
                <li>
                  <a
                    className="text-gray-600 transition hover:text-gray-900"
                    href={REPO}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Repository
                  </a>
                </li>
                <li>
                  <a
                    className="text-gray-600 transition hover:text-gray-900"
                    href={`${REPO}/blob/main/LICENSE`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Apache-2.0
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* The second line states properties, not boilerplate — the idea is worth borrowing from
            the sites that put "Open source · Non-custodial" here. Not "non-custodial" for us
            though: Hold really does keep USDC until it is claimed, so that word would claim more
            than we can defend. "No admin key" says the thing that actually matters — nobody can
            take those funds — and it is one of the six guarantees already on the page.

            No "All rights reserved" either, whatever the neighbours do. It asserts the opposite
            of the Apache-2.0 licence this repository ships, and the licence is what governs. */}
        <div className="flex flex-col items-center gap-0.5 pb-6 text-center text-xs text-gray-500 sm:flex-row sm:justify-between sm:gap-1 sm:text-left sm:text-sm sm:text-gray-600">
          <div>&copy; {new Date().getFullYear()} Skyhook &middot; Apache-2.0</div>
          <div className="text-gray-400 sm:text-gray-500">
            No admin key &middot; Permissionless &middot; Stellar Testnet
          </div>
        </div>
      </div>
    </footer>
  );
}

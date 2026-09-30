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
          className={`grid grid-cols-2 gap-x-6 gap-y-8 py-8 sm:grid-cols-12 sm:gap-10 md:py-12 ${
            border
              ? 'border-t [border-image:linear-gradient(to_right,transparent,var(--color-slate-200),transparent)1]'
              : ''
          }`}
        >
          {/* 1st block */}
          <div className="col-span-2 space-y-2 sm:col-span-12 lg:col-span-4">
            <div>
              <FooterLogo />
            </div>
            <div className="text-sm text-gray-600">
              The execution layer for CCTP hooks on Stellar.
            </div>
          </div>

          {/* 2nd block */}
          <div className="space-y-2 sm:col-span-6 md:col-span-3 lg:col-span-2">
            <h3 className="text-sm font-medium">Documentation</h3>
            <ul className="space-y-2 text-sm">
              {[
                ['Overview', '/docs'],
                ['Integration guide', '/docs/integration'],
                ['Writing a handler', '/docs/handlers'],
                ['Running a relayer', '/docs/relayer'],
              ].map(([text, href]) => (
                <li key={href}>
                  <Link className="text-gray-600 transition hover:text-gray-900" href={href}>
                    {text}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* 3rd block */}
          <div className="space-y-2 sm:col-span-6 md:col-span-3 lg:col-span-2">
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
          <div className="space-y-2 sm:col-span-6 md:col-span-3 lg:col-span-2">
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

          {/* 5th block */}
          <div className="space-y-2 sm:col-span-6 md:col-span-3 lg:col-span-2">
            <h3 className="text-sm font-medium">Social</h3>
            <ul className="flex gap-1">
              <li>
                <a
                  className="flex items-center justify-center text-blue-500 transition hover:text-blue-600"
                  href="https://x.com/skyhookprotocol"
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Skyhook on X"
                >
                  <svg className="h-8 w-8 fill-current" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
                    <path d="m13.063 9 3.495 4.475L20.601 9h2.454l-5.359 5.931L24 23h-4.938l-3.866-4.893L10.771 23H8.316l5.735-6.342L8 9h5.063Zm-.74 1.347h-1.457l8.875 11.232h1.36l-8.778-11.232Z" />
                  </svg>
                </a>
              </li>
              <li>
                <a
                  className="flex items-center justify-center text-blue-500 transition hover:text-blue-600"
                  href={REPO}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Skyhook on GitHub"
                >
                  <svg className="h-8 w-8 fill-current" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
                    <path d="M16 8.2c-4.4 0-8 3.6-8 8 0 3.5 2.3 6.5 5.5 7.6.4.1.5-.2.5-.4V22c-2.2.5-2.7-1-2.7-1-.4-.9-.9-1.2-.9-1.2-.7-.5.1-.5.1-.5.8.1 1.2.8 1.2.8.7 1.3 1.9.9 2.3.7.1-.5.3-.9.5-1.1-1.8-.2-3.6-.9-3.6-4 0-.9.3-1.6.8-2.1-.1-.2-.4-1 .1-2.1 0 0 .7-.2 2.2.8.6-.2 1.3-.3 2-.3s1.4.1 2 .3c1.5-1 2.2-.8 2.2-.8.4 1.1.2 1.9.1 2.1.5.6.8 1.3.8 2.1 0 3.1-1.9 3.7-3.7 3.9.3.4.6.9.6 1.6v2.2c0 .2.1.5.6.4 3.2-1.1 5.5-4.1 5.5-7.6-.1-4.4-3.7-8-8.1-8z" />
                  </svg>
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="border-t border-gray-100 py-6 text-sm text-gray-600">
          &copy; {new Date().getFullYear()} Skyhook &middot; Apache-2.0
        </div>
      </div>
    </footer>
  );
}

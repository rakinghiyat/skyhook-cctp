import Link from 'next/link';
import Logo from './logo';
import MobileMenu from './mobile-menu';

const REPO = 'https://github.com/rakinghiyat/skyhook-cctp';

// The template's floating pill, with our own arrangement inside it: lockup, Docs and Claim all to
// the left, and the two social marks on the right.
//
// No search and no theme switch. Both belong to /docs, where Fumadocs provides them; pulling them
// in here would drag the dark theme onto a page the template never designed for one.
//
// Below `md` the whole middle collapses into a menu. The pill had run out of room — lockup, two
// links and two icons came to 347px against the 360px of a common Android — and a menu returns
// the width rather than shaving another pixel off the gaps.
export default function Header() {
  return (
    <header className="fixed top-2 z-30 w-full md:top-6">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="pill-border relative flex h-14 items-center justify-between gap-2 rounded-2xl bg-white/90 px-3 shadow-lg shadow-black/[0.03] backdrop-blur-xs md:gap-10">
          <Logo />

          <nav className="hidden md:mr-auto md:block">
            <ul className="flex items-center gap-4 text-base font-medium md:gap-7">
              <li>
                <Link href="/docs" className="text-gray-500 transition hover:text-gray-900">
                  Docs
                </Link>
              </li>
              <li>
                <Link href="/claim" className="text-gray-500 transition hover:text-gray-900">
                  Claim
                </Link>
              </li>
            </ul>
          </nav>

          {/* Both marks in brand blue, the colour they already had in the footer — the footer's
              Social column is gone, so this is now the only place they appear. Both SVGs use a
              32 viewBox with the glyph drawn at the same scale, so they need no size correction
              against each other. */}
          <div className="hidden items-center md:flex">
            <a
              href="https://x.com/skyhookprotocol"
              target="_blank"
              rel="noreferrer"
              aria-label="Skyhook on X"
              className="flex items-center justify-center text-blue-500 transition hover:text-blue-600"
            >
              <svg className="h-8 w-8 fill-current" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
                <path d="m13.063 9 3.495 4.475L20.601 9h2.454l-5.359 5.931L24 23h-4.938l-3.866-4.893L10.771 23H8.316l5.735-6.342L8 9h5.063Zm-.74 1.347h-1.457l8.875 11.232h1.36l-8.778-11.232Z" />
              </svg>
            </a>
            <a
              href={REPO}
              target="_blank"
              rel="noreferrer"
              aria-label="Skyhook on GitHub"
              className="flex items-center justify-center text-blue-500 transition hover:text-blue-600"
            >
              <svg className="h-8 w-8 fill-current" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
                <path d="M16 8.2c-4.4 0-8 3.6-8 8 0 3.5 2.3 6.5 5.5 7.6.4.1.5-.2.5-.4V22c-2.2.5-2.7-1-2.7-1-.4-.9-.9-1.2-.9-1.2-.7-.5.1-.5.1-.5.8.1 1.2.8 1.2.8.7 1.3 1.9.9 2.3.7.1-.5.3-.9.5-1.1-1.8-.2-3.6-.9-3.6-4 0-.9.3-1.6.8-2.1-.1-.2-.4-1 .1-2.1 0 0 .7-.2 2.2.8.6-.2 1.3-.3 2-.3s1.4.1 2 .3c1.5-1 2.2-.8 2.2-.8.4 1.1.2 1.9.1 2.1.5.6.8 1.3.8 2.1 0 3.1-1.9 3.7-3.7 3.9.3.4.6.9.6 1.6v2.2c0 .2.1.5.6.4 3.2-1.1 5.5-4.1 5.5-7.6-.1-4.4-3.7-8-8.1-8z" />
              </svg>
            </a>
          </div>

          <MobileMenu repo={REPO} />
        </div>
      </div>
    </header>
  );
}

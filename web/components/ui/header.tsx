import Link from 'next/link';
import Logo from './logo';

// The template's floating pill, with our own arrangement inside it: wordmark, Docs and Claim all
// to the left, and the repository alone on the right.
//
// No search and no theme switch. Both belong to /docs, where Fumadocs provides them; pulling
// them in here would drag the dark theme onto a page the template never designed for one.
export default function Header() {
  return (
    <header className="fixed top-2 z-30 w-full md:top-6">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="pill-border relative flex h-14 items-center justify-between gap-3 rounded-2xl bg-white/90 px-3 shadow-lg shadow-black/[0.03] backdrop-blur-xs">
          <div className="flex items-center gap-5 md:gap-10">
            <Logo />
            <nav>
              <ul className="flex items-center gap-5 text-base font-medium md:gap-7">
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
          </div>

          <a
            href="https://github.com/rakinghiyat/skyhook-cctp"
            target="_blank"
            rel="noreferrer"
            aria-label="Skyhook on GitHub"
            className="flex items-center justify-center text-gray-700 transition hover:text-gray-900"
          >
            <svg className="h-8 w-8 fill-current" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
              <path d="M16 8.2c-4.4 0-8 3.6-8 8 0 3.5 2.3 6.5 5.5 7.6.4.1.5-.2.5-.4V22c-2.2.5-2.7-1-2.7-1-.4-.9-.9-1.2-.9-1.2-.7-.5.1-.5.1-.5.8.1 1.2.8 1.2.8.7 1.3 1.9.9 2.3.7.1-.5.3-.9.5-1.1-1.8-.2-3.6-.9-3.6-4 0-.9.3-1.6.8-2.1-.1-.2-.4-1 .1-2.1 0 0 .7-.2 2.2.8.6-.2 1.3-.3 2-.3s1.4.1 2 .3c1.5-1 2.2-.8 2.2-.8.4 1.1.2 1.9.1 2.1.5.6.8 1.3.8 2.1 0 3.1-1.9 3.7-3.7 3.9.3.4.6.9.6 1.6v2.2c0 .2.1.5.6.4 3.2-1.1 5.5-4.1 5.5-7.6-.1-4.4-3.7-8-8.1-8z" />
            </svg>
          </a>
        </div>
      </div>
    </header>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

/**
 * The phone menu: a hamburger that opens the four destinations the wide header shows inline.
 *
 * The header has no room left. It carries a lockup, two links and two icons, which came to 347px
 * against the 360px of a common Android — thirteen pixels of slack, and every future addition
 * would have had to take something out. Collapsing it into a menu returns the whole width.
 *
 * Closing is handled three ways because a menu that only closes on its own button is a trap on a
 * touch screen: the toggle, a tap anywhere outside, and Escape.
 *
 * No rule between the links and the social entries: four rows is short enough to read as one
 * list. X is the only icon-only row, so its name lives in `aria-label` where a screen reader
 * still reaches it.
 */
export default function MobileMenu({ repo }: { repo: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative md:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Menu"
        aria-expanded={open}
        className="flex size-9 items-center justify-center rounded-lg text-gray-700 transition hover:bg-gray-100"
      >
        <svg width={20} height={20} viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path
            d={open ? 'M5 5l10 10M15 5L5 15' : 'M3 6h14M3 10h14M3 14h14'}
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
          />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-52 overflow-hidden rounded-xl bg-white shadow-lg shadow-black/[0.06] ring-1 ring-gray-200/80">
          <Link
            href="/docs"
            onClick={() => setOpen(false)}
            className="block px-4 py-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            Documentation
          </Link>
          <Link
            href="/claim"
            onClick={() => setOpen(false)}
            className="block px-4 py-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            Claim
          </Link>
          <a
            href={repo}
            target="_blank"
            rel="noreferrer"
            onClick={() => setOpen(false)}
            className="block px-4 py-3 text-sm font-medium text-blue-500 transition hover:bg-gray-50"
          >
            GitHub
          </a>
          <a
            href="https://x.com/skyhookprotocol"
            target="_blank"
            rel="noreferrer"
            onClick={() => setOpen(false)}
            aria-label="Skyhook on X"
            className="flex px-4 py-3 text-blue-500 transition hover:bg-gray-50"
          >
            <svg className="size-5 fill-current" viewBox="0 0 32 32" aria-hidden="true">
              <path d="m13.063 9 3.495 4.475L20.601 9h2.454l-5.359 5.931L24 23h-4.938l-3.866-4.893L10.771 23H8.316l5.735-6.342L8 9h5.063Zm-.74 1.347h-1.457l8.875 11.232h1.36l-8.778-11.232Z" />
            </svg>
          </a>
        </div>
      )}
    </div>
  );
}

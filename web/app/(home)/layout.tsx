'use client';

import { useEffect } from 'react';
import AOS from 'aos';
import 'aos/dist/aos.css';

import Header from '@/components/ui/header';
import Footer from '@/components/ui/footer';
import PageGlow from '@/components/page-glow';

// The template's own layout, with one addition: `color-scheme: light` and no dark variants
// anywhere beneath it.
//
// Fumadocs puts `.dark` on <html> when a reader switches theme in the docs. These pages emit no
// `dark:` classes, so that class finds nothing to act on and they stay light — which is right,
// because the template was never designed for a dark counterpart.
export default function HomeLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    AOS.init({ once: true, disable: 'phone', duration: 700, easing: 'ease-out-cubic' });
  }, []);

  return (
    // `isolate` is load-bearing, not decoration. The stripes behind the hero sit at `-z-10`; a
    // plain wrapper is not a stacking context, so they escape to the root and end up painted
    // *beneath* this element's own background — present in the DOM, correctly positioned, and
    // completely invisible. The template avoids it by putting the background on <body>, which we
    // cannot do because /docs shares that element. Making this a stacking context is the
    // equivalent fix: the background paints first, the negative-z children paint above it.
    <div className="relative isolate flex min-h-screen flex-col bg-gray-50 text-gray-900 [color-scheme:light]">
      <PageGlow />
      <Header />
      <main className="grow">{children}</main>
      <Footer border={true} />
    </div>
  );
}

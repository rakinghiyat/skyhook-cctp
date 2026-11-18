'use client';

import { useEffect } from 'react';
import AOS from 'aos';
import 'aos/dist/aos.css';

import Header from '@/components/ui/header';
import Footer from '@/components/ui/footer';
import PageGlow from '@/components/page-glow';

// The template's layout, plus `color-scheme: light`. Fumadocs may put `.dark` on <html> from the
// docs, but these pages have no `dark:` classes, so they stay light.
export default function HomeLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    AOS.init({ once: true, disable: 'phone', duration: 700, easing: 'ease-out-cubic' });
  }, []);

  return (
    // `overflow-x-clip` is needed: the 768px stripes image made phone screens scroll sideways.
    // `clip`, not `hidden`, so this doesn't become a scroll container.
    //
    // `isolate` is needed too. Without a stacking context the `-z-10` stripes get painted under
    // this element's background and vanish. (The template puts the background on <body>, but
    // /docs shares that.)
    <div className="relative isolate flex min-h-screen flex-col overflow-x-clip bg-gray-50 text-gray-900 [color-scheme:light]">
      <PageGlow />
      <Header />
      <main className="grow">{children}</main>
      <Footer border={true} />
    </div>
  );
}

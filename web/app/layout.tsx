import { RootProvider } from 'fumadocs-ui/provider/next';
import './global.css';
import { Figtree } from 'next/font/google';
import type { Metadata } from 'next';

// Circle sets its pages in Circular XX, which is a Lineto typeface licensed to them and not
// something we can use. Figtree is the closest thing that is free: the same geometric skeleton,
// double-storey `a`, single-storey `g`, tall x-height.
const figtree = Figtree({ subsets: ['latin'], display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'Skyhook', template: '%s — Skyhook' },
  description:
    'The execution layer for CCTP hooks on Stellar, so USDC does something the moment it lands.',
  icons: { icon: '/favicon.png' },
};

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={figtree.className} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        {/* Light by default: the brand is a light mark, and the palette was chosen against
            white. The toggle stays, because a documentation site is read for long stretches
            and that is a reader's call to make, not ours. */}
        <RootProvider theme={{ defaultTheme: 'light' }}>{children}</RootProvider>
      </body>
    </html>
  );
}

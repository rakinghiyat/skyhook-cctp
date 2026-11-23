import { RootProvider } from 'fumadocs-ui/provider/next';
import './global.css';
import { Figtree } from 'next/font/google';
import type { Metadata } from 'next';
import { Analytics } from '@vercel/analytics/next';

// Circle uses Circular XX, a licensed font. Figtree is the closest free match: geometric,
// double-storey `a`, single-storey `g`, tall x-height.
const figtree = Figtree({ subsets: ['latin'], display: 'swap' });

// Where Open Graph images resolve from. Without it Next uses localhost, and link previews (like
// the demo video post on X) break.
//
// Vercel sets `VERCEL_PROJECT_PRODUCTION_URL` to the production domain, even in previews.
// `NEXT_PUBLIC_SITE_URL` overrides it for other hosts.
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : 'http://localhost:3000');

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: 'Skyhook', template: '%s | Skyhook' },
  description:
    'The execution layer for CCTP hooks on Stellar, so USDC does something the moment it lands.',
  icons: { icon: '/favicon.png' },
};

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={figtree.className} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        {/* Light by default, since the brand was designed on white. Docs readers can still
            switch to dark. */}
        <RootProvider theme={{ defaultTheme: 'light' }}>{children}</RootProvider>
        <Analytics />
      </body>
    </html>
  );
}

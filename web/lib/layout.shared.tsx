import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

/**
 * Layout options for the docs pages only. The landing and claim pages use the template's own
 * header. The docs show their own wordmark (lockup plus DOCS) so readers know where they are.
 *
 * `themeSwitch.enabled: false` is on purpose. The switch is drawn above "On this page" instead
 * (see `app/docs/[[...slug]]/page.tsx`), so the sidebar box only holds GitHub and X.
 */
export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="inline-flex items-center">
          {/* Two files, not one with `invert`, which would also flip the blue hook. Both are
              cropped to their content, or `h-7` makes the mark tiny. */}
          <img src="/docs-wordmark-black.png" alt="Skyhook Docs" className="h-7 w-auto dark:hidden" />
          <img src="/docs-wordmark-white.png" alt="Skyhook Docs" className="hidden h-7 w-auto dark:block" />
        </span>
      ),
    },
    links: [
      { text: 'Claim', url: '/claim' },
      {
        type: 'icon',
        text: 'X',
        label: 'Skyhook on X',
        url: 'https://x.com/skyhookcctp',
        external: true,
        // The viewBox is cropped to the glyph (8 to 24 of a 32 box), or it looks smaller than the
        // GitHub mark. `skyhook-social` isn't for styling: `app/global.css` uses it to find the box.
        icon: (
          <svg className="skyhook-social" viewBox="8 8 16 16" fill="currentColor" aria-hidden="true">
            <path d="m13.063 9 3.495 4.475L20.601 9h2.454l-5.359 5.931L24 23h-4.938l-3.866-4.893L10.771 23H8.316l5.735-6.342L8 9h5.063Zm-.74 1.347h-1.457l8.875 11.232h1.36l-8.778-11.232Z" />
          </svg>
        ),
      },
    ],
    githubUrl: 'https://github.com/rakinghiyat/skyhook-cctp',
    themeSwitch: { enabled: false },
  };
}

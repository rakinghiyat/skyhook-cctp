import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

/**
 * Chrome for the documentation pages only.
 *
 * The landing and claim pages use the template's own header (`components/ui/header`); the docs
 * keep Fumadocs' sidebar layout, which expects this shape and brings the search dialog with it.
 * The docs carry their own wordmark, the lockup plus DOCS, so a reader always knows which
 * half of the site they are in.
 *
 * `themeSwitch.enabled: false` is deliberate and works with `sidebar.footer` in
 * `app/docs/layout.tsx`. Fumadocs puts the icon links and the theme switch inside one bordered
 * box in the sidebar footer, with the switch restyled to blend into it. Turning it off here
 * leaves that box holding only GitHub and X; the switch is then rendered as the footer beneath,
 * in a box of its own.
 */
export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="inline-flex items-center">
          {/* Two files rather than one inverted: `invert` on a black wordmark gives white, but it
              flips every other pixel too. Both ship with two thirds of their height as empty
              canvas, so each is cropped to its bounding box or `h-7` shrinks the mark to nothing. */}
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
        url: 'https://x.com/skyhookprotocol',
        external: true,
        // The viewBox is cropped to the glyph: the path is drawn in a 32 box but only occupies
        // 8–24 of it, so at `0 0 32 32` it renders visibly smaller than the GitHub mark beside it.
        // `skyhook-social` is not styling — it is the only child of that box we author, so it is
        // what `app/global.css` uses to find the box itself.
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

'use client';

import type { ComponentProps } from 'react';
import { useDocsLayout } from 'fumadocs-ui/layouts/docs';
import { buttonVariants } from 'fumadocs-ui/components/ui/button';
import { SidebarIcon } from 'lucide-react';
import ThemeToggle from './theme-toggle';

/**
 * The docs header on phones, replacing Fumadocs' own so the theme toggle can sit between the
 * search and sidebar buttons.
 *
 * Fumadocs offers one injection point in this bar, `nav.children`, and it renders *before* the
 * search trigger — so it cannot put anything between the two. Taking the whole slot is the only
 * way to choose the order.
 *
 * **This is a copy of Fumadocs' `layouts/docs/slots/header.tsx` with one child inserted**, which
 * means it does not follow along when they change theirs. The parts worth re-checking after a
 * Fumadocs upgrade are the class string below and the shape of `useDocsLayout()`. Everything
 * here is public API: `useDocsLayout` from `layouts/docs`, `buttonVariants` from
 * `components/ui/button`.
 */
export default function DocsHeader(props: ComponentProps<'header'>) {
  const {
    isNavTransparent,
    slots,
    props: { nav },
  } = useDocsLayout();

  if (nav?.component) return nav.component;

  return (
    <header
      id="nd-subnav"
      data-transparent={isNavTransparent}
      {...props}
      className={`[grid-area:header] sticky top-(--fd-docs-row-1) z-30 flex h-(--fd-header-height) items-center border-b ps-4 pe-2.5 backdrop-blur-sm transition-colors data-[transparent=false]:bg-fd-background/80 max-md:layout:[--fd-header-height:--spacing(14)] md:hidden ${props.className ?? ''}`}
    >
      {slots.navTitle && (
        <slots.navTitle className="inline-flex items-center gap-2.5 font-semibold" />
      )}
      <div className="flex-1">{nav?.children}</div>
      {slots.searchTrigger && <slots.searchTrigger.sm hideIfDisabled className="p-2" />}
      <ThemeToggle />
      {slots.sidebar && (
        <slots.sidebar.trigger
          className={buttonVariants({ variant: 'ghost', size: 'icon-sm', className: 'p-2' })}
        >
          <SidebarIcon />
        </slots.sidebar.trigger>
      )}
    </header>
  );
}

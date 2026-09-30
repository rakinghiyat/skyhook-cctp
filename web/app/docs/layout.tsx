import { source } from '@/lib/source';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { baseOptions } from '@/lib/layout.shared';
import DocsHeader from '@/components/ui/docs-header';

export default function Layout({ children }: LayoutProps<'/docs'>) {
  return (
    // The phone header is ours so the theme toggle can sit between search and sidebar;
    // Fumadocs' only hook in that bar renders before the search button. See the component.
    <DocsLayout tree={source.getPageTree()} {...baseOptions()} slots={{ header: DocsHeader }}>
      {children}
    </DocsLayout>
  );
}

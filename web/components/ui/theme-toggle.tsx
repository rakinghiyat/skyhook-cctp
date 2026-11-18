'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Moon, Sun } from 'lucide-react';

/**
 * One icon, one tap. It shows the theme you'd switch to: a moon on light, a sun on dark.
 * Fumadocs' `ThemeSwitch` is too wide for a phone header.
 *
 * State comes from `next-themes`, the same library Fumadocs uses, so the two stay in sync. It's
 * declared in `package.json` so a Fumadocs update can't remove it.
 *
 * Renders nothing until mounted, because the server can't know the theme.
 */
export default function ThemeToggle({ className = '' }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const dark = resolvedTheme === 'dark';

  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      className={`inline-flex items-center justify-center rounded-md p-2 text-fd-muted-foreground transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground ${className}`}
    >
      {mounted ? (
        dark ? (
          <Sun className="size-4.5" />
        ) : (
          <Moon className="size-4.5" />
        )
      ) : (
        <span className="size-4.5" />
      )}
    </button>
  );
}

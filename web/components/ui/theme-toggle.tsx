'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Moon, Sun } from 'lucide-react';

/**
 * One icon, one tap. The icon shows the theme you would *get*, not the one you are in: a moon
 * while the page is light, a sun while it is dark. Fumadocs' own `ThemeSwitch` is a segmented
 * control of two or three buttons, which is more chrome than a phone header has room for.
 *
 * `next-themes` holds the state — it is what Fumadocs' `RootProvider` uses underneath, so reading
 * it here keeps this button and the docs in agreement rather than fighting over the class on
 * `<html>`. It is declared in `package.json` rather than borrowed from Fumadocs' own tree, so a
 * future Fumadocs release cannot quietly take it away.
 *
 * Nothing is rendered until mounted. The server cannot know the theme, so an icon chosen before
 * hydration is a coin flip and React would report the mismatch.
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

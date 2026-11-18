import Link from 'next/link';

// The full lockup as one image, so the hook and wordmark always line up.
export default function Logo() {
  return (
    <Link href="/" className="inline-flex shrink-0" aria-label="Skyhook">
      <img src="/lockup.png" alt="Skyhook" className="h-8 w-auto" />
    </Link>
  );
}

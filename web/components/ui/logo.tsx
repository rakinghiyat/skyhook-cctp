import Link from 'next/link';

// The full lockup in one asset: the hook and the wordmark as the brand draws them together,
// rather than two images placed side by side and hoped into alignment.
export default function Logo() {
  return (
    <Link href="/" className="inline-flex shrink-0" aria-label="Skyhook">
      <img src="/lockup.png" alt="Skyhook" className="h-8 w-auto" />
    </Link>
  );
}

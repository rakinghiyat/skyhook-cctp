import Link from 'next/link';

// The footer uses only the wordmark. The header introduces the brand with the full lockup.
export default function FooterLogo() {
  return (
    <Link href="/" className="inline-flex shrink-0" aria-label="Skyhook">
      <img src="/wordmark.png" alt="Skyhook" className="h-6 w-auto" />
    </Link>
  );
}

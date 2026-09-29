import Link from 'next/link';

// The footer uses the wordmark alone, while the header carries the full lockup. Two different
// marks for two different jobs: the header introduces the brand, the footer only has to name it
// once more on the way out.
export default function FooterLogo() {
  return (
    <Link href="/" className="inline-flex shrink-0" aria-label="Skyhook">
      <img src="/wordmark.png" alt="Skyhook" className="h-6 w-auto" />
    </Link>
  );
}

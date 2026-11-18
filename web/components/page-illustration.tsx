import Image from 'next/image';

// The stripes behind the hero, from the template. The colour lives in `components/page-glow`.
export default function PageIllustration() {
  return (
    <div
      className="pointer-events-none absolute left-1/2 top-0 -z-10 -translate-x-1/2 transform"
      aria-hidden="true"
    >
      <Image className="max-w-none" src="/images/stripes.svg" width={768} height={420} alt="" priority />
    </div>
  );
}

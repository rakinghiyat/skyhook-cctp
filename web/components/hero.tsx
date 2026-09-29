import PageIllustration from '@/components/page-illustration';

// The hero: the template's frame and rhythm — `max-w-6xl`, `pb-12 pt-32 md:pb-20 md:pt-40`,
// the same button treatment — without the gradient rules the template draws above and below
// each block. Those hairlines are the template's own accent and read as clutter here, where the
// headline has to do all the work on its own.
export default function Hero() {
  return (
    <section className="relative">
      <PageIllustration />
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="flex min-h-svh flex-col justify-center pb-40 pt-32 text-center md:pb-60 md:pt-40">
          {/* The dot does the work: green for the brand, and it pulses because the point of the
              line is that this is running right now, not that it is planned. */}
          <div className="mb-6" data-aos="zoom-y-out">
            <span className="inline-flex items-center gap-2 rounded-full bg-white/70 px-3.5 py-1.5 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-gray-200/80 backdrop-blur-sm">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
              </span>
              Live on Stellar Testnet
            </span>
          </div>

          <h1
            className="mb-6 text-5xl font-bold text-gray-900 md:text-6xl"
            data-aos="zoom-y-out"
            data-aos-delay={150}
          >
            USDC that does something
            <br className="max-lg:hidden" /> the moment it lands
          </h1>

          <div className="mx-auto max-w-3xl">
            <p
              className="mb-8 text-lg text-gray-700"
              data-aos="zoom-y-out"
              data-aos-delay={300}
            >
              Circle&rsquo;s CCTP delivers native USDC to Stellar but does not execute hooks.
              Skyhook reads the payload it leaves behind and runs the instruction inside it.
            </p>

            <div
              className="mx-auto max-w-xs sm:flex sm:max-w-none sm:justify-center"
              data-aos="zoom-y-out"
              data-aos-delay={450}
            >
              <a
                className="btn group mb-4 w-full bg-linear-to-t from-blue-600 to-blue-500 bg-[length:100%_100%] bg-[bottom] text-white shadow-sm hover:bg-[length:100%_150%] sm:mb-0 sm:w-auto"
                href="/docs"
              >
                <span className="relative inline-flex items-center">
                  Read the docs{' '}
                  <span className="ml-1.5 text-blue-200 transition-transform group-hover:translate-x-0.5">
                    &rarr;
                  </span>
                </span>
              </a>
              <a
                className="btn w-full bg-white text-gray-800 shadow-sm hover:bg-gray-50 sm:ml-4 sm:w-auto"
                href="/claim"
              >
                Claim held funds
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// The closing block: a heading, what integrating involves, one button. Modelled on Circle's
// closing section.
export default function Cta() {
  return (
    <section>
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="py-16 text-center md:py-24" data-aos="zoom-y-out">
          <h2 className="mb-5 text-3xl font-bold text-gray-900 md:text-4xl">
            Send USDC that arrives already working
          </h2>
          <p className="mx-auto mb-9 max-w-2xl text-lg text-gray-600">
            Point a Deposit instruction at any SEP-56 vault and the USDC lands as a position the
            recipient holds. No second transaction, and no USDC trustline, because vault shares
            live in the vault&rsquo;s own storage. The vault address travels in the instruction,
            so switching to a different one is a change of parameter, not of code.
          </p>
          <div className="mx-auto max-w-xs sm:flex sm:max-w-none sm:justify-center">
            <a
              className="btn w-full bg-gray-900 text-white shadow-sm hover:bg-gray-800 sm:w-auto"
              href="/docs/integration"
            >
              Get Started
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

// The deployed set, in the template's section frame.
//
// Addresses rather than logos: the thing a reader can check for themselves is that these resolve
// on a public explorer, and that is worth more here than a wall of partner marks.
const CONTRACTS: [string, string][] = [
  ['skyhook-core', 'CCOMST7FEDLYJ5MXZTVKVKMK43AQP2U2AZEZRHE3XHYO6UF6LKC2654F'],
  ['handler-deposit', 'CBZOKXZKKORG4FI5URPJMX3XHBDU6E7EXPD4YY36R36PHVOMEKWXRVFY'],
  ['handler-hold', 'CCLVTDVGYHSWFC7AW2L327WMFZVKZDFYY24G7Z4IZO2SQDM4DVWE7TC6'],
  ['reference vault', 'CAY6UNOOWATJW2LXFGMTO6NKLJRVWRKMNVZVPGLKRBLE5Y6OFMDF7IB4'],
];

export default function Deployed() {
  return (
    <section>
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="py-16 md:py-24">
          <div className="mx-auto max-w-3xl pb-10 text-center md:pb-12">
            <h2 className="mb-4 text-3xl font-bold text-gray-900 md:text-4xl">
              Deployed, and checkable
            </h2>
            <p className="text-lg text-gray-700">
              Every address below resolves on a public explorer. Testnet only, and not audited.
            </p>
          </div>

          <div className="mx-auto max-w-2xl" data-aos="zoom-y-out" data-aos-delay={150}>
            <ul className="divide-y divide-gray-200 rounded-2xl bg-white px-6 shadow-lg shadow-black/[0.03]">
              {CONTRACTS.map(([name, id]) => (
                <li key={id} className="flex items-center justify-between gap-4 py-4">
                  <span className="text-sm text-gray-600">{name}</span>
                  <a
                    href={`https://stellar.expert/explorer/testnet/contract/${id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-[13px] text-gray-800 underline decoration-gray-300 underline-offset-2 transition hover:decoration-gray-800"
                  >
                    {id.slice(0, 8)}…{id.slice(-6)}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

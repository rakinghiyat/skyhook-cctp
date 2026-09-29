import Hero from '@/components/hero';
import Steps from '@/components/steps';
import Guarantees from '@/components/guarantees';
import Deployed from '@/components/deployed';
import Cta from '@/components/cta';

export const metadata = {
  title: 'Skyhook — CCTP hooks on Stellar',
  description:
    'The execution layer for CCTP hooks on Stellar, so USDC does something the moment it lands.',
};

export default function Home() {
  return (
    <>
      <Hero />
      <Steps />
      <Guarantees />
      <Cta />
      <Deployed />
    </>
  );
}

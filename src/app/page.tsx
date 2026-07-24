import { Nav } from "./_components/landing/nav";
import { Hero } from "./_components/landing/hero";
import { HowItWorks } from "./_components/landing/how-it-works";
import { Features } from "./_components/landing/features";
import { Pricing } from "./_components/landing/pricing";
import { Faq } from "./_components/landing/faq";
import { FinalCta } from "./_components/landing/final-cta";
import { Footer } from "./_components/landing/footer";

export default function LandingPage() {
  return (
    <main className="flex-1">
      <Nav />
      <Hero />
      <HowItWorks />
      <Features />
      <Pricing />
      <Faq />
      <FinalCta />
      <Footer />
    </main>
  );
}

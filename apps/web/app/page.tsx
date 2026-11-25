import { About } from "@/components/landing/about";
import { IconSprite } from "@/components/landing/art/icon-sprite";
import { Faq } from "@/components/landing/faq";
import { FinalCta } from "@/components/landing/final-cta";
import { Hero } from "@/components/landing/hero";
import { HowItWorks } from "@/components/landing/how-it-works";
import { Maintainers } from "@/components/landing/maintainers";
import { Prizes } from "@/components/landing/prizes";
import { Scoring } from "@/components/landing/scoring";
import { ScrollEffects } from "@/components/landing/scroll-effects";
import { SiteFooter } from "@/components/landing/site-footer";
import { SiteHeader } from "@/components/landing/site-header";
import { NightSnow } from "@/components/landing/snow";
import { Timeline } from "@/components/landing/timeline";
import { getViewer } from "@/lib/dal";

export default async function HomePage() {
  // Signed-in visitors see "Dashboard" where others see "Register".
  const viewer = await getViewer();
  return (
    <>
      <IconSprite />
      <SiteHeader viewer={viewer} />
      <main id="top">
        <Hero viewer={viewer} />
        {/* Continuous winter-night background behind every section below the hero. */}
        <div className="night">
          <About viewer={viewer} />
          <HowItWorks />
          <Scoring />
          <Timeline />
          <Prizes />
          <Maintainers />
          <Faq />
          <FinalCta viewer={viewer} />
          {/* Last, so the snow paints in front of the scene art but still behind all content. */}
          <NightSnow />
        </div>
      </main>
      <SiteFooter viewer={viewer} />
      <ScrollEffects />
    </>
  );
}

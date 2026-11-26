import { accountLink, links, type Viewer } from "@/lib/content";
import { FinalScene } from "./art/final-scene";
import { Icon } from "./icon";

const COPY: Record<Viewer, { title: string; text: string }> = {
  "signed-out": {
    title: "Ready to make your first merge?",
    text: "Registrations open soon. Sign in with GitHub to get notified when Mergio begins.",
  },
  unregistered: {
    title: "Almost there.",
    text: "You're signed in, but your registration isn't finished yet. It takes a minute.",
  },
  registered: {
    title: "You're registered.",
    text: "Your dashboard shows your roles and what happens next.",
  },
};

export function FinalCta({ viewer }: { viewer: Viewer }) {
  const account = accountLink(viewer);
  const copy = COPY[viewer];
  return (
    <section className="final" id="register">
      <FinalScene />
      <div className="wrap">
        <h2 className="reveal">{copy.title}</h2>
        <p className="reveal">{copy.text}</p>
        <div className="hero-cta reveal">
          <a className="btn btn-primary" href={account.href}>
            <Icon name={account.icon} size={18} />
            {account.long}
          </a>
          <a className="btn btn-ghost" href={links.discord}>
            Join our Discord
          </a>
        </div>
      </div>
    </section>
  );
}

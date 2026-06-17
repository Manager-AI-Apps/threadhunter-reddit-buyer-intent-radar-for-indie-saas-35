import Link from "next/link";
import { BarChart2, Mail, List } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FeatureGrid, type Feature } from "@/components/blocks/feature-grid";
import { Hero } from "@/components/blocks/hero";
import { ThemeToggle } from "@/components/theme-toggle";

const FEATURES: Feature[] = [
  {
    icon: <BarChart2 className="size-6" />,
    title: "Intent Scoring",
    description:
      "Every thread is labeled — asking-for-recs, complaining-about-incumbent, comparing-tools — and scored 0–100 so you only reply where it counts.",
  },
  {
    icon: <Mail className="size-6" />,
    title: "Weekly Digest",
    description:
      "Receive 5–10 ranked threads per product every week, each with a suggested angle and a disclosure-safe reply scaffold ready to paste.",
  },
  {
    icon: <List className="size-6" />,
    title: "Subreddit Watchlist",
    description:
      "Pin 3–8 subreddits and set allow/block rules. One-click false-positive feedback retrains scoring so the list gets sharper over time.",
  },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <span className="font-display text-base font-semibold tracking-tight">
          ThreadHunter
        </span>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href="/sign-in">Sign in</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/sign-up">Sign up</Link>
          </Button>
          <ThemeToggle />
        </div>
      </header>

      <Hero
        eyebrow={
          <Badge variant="secondary" className="px-3 py-1 text-sm font-medium">
            Reddit buyer-intent radar for indie SaaS
          </Badge>
        }
        title={
          <>
            ThreadHunter — Find buyers on Reddit before they find you
          </>
        }
        subtitle="Stop drowning in false-positive keyword pings. ThreadHunter scores every thread by buyer-intent and delivers a weekly shortlist of 5–10 high-signal threads worth replying to — not 500 noise alerts."
        actions={
          <>
            <Button asChild size="lg">
              <Link href="/sign-up">Get started free</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/sign-in">Sign in</Link>
            </Button>
          </>
        }
      />

      <FeatureGrid features={FEATURES} />
    </main>
  );
}

/**
 * Billing — Plan Selection & Upgrade
 *
 * Server component. Shows the Starter and Pro plan cards with pricing and
 * feature highlights, and a CTA to open a Stripe Checkout session.
 *
 * Auth: required — unauthenticated visitors are sent to /sign-in.
 */

import * as React from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Check, CreditCard, Inbox, Settings, Zap } from "lucide-react";

import { auth } from "@/lib/auth";
import { AppShell, type NavItem } from "@/components/app-shell";
import { PageHeader } from "@/components/blocks/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckoutButton } from "./_components/checkout-button";

// ── Nav ───────────────────────────────────────────────────────────────────────

const NAV: NavItem[] = [
  {
    title: "Thread Inbox",
    href: "/dashboard",
    icon: <Inbox className="size-4" />,
  },
  {
    title: "Billing",
    href: "/billing",
    icon: <CreditCard className="size-4" />,
  },
  {
    title: "Settings",
    href: "/settings",
    icon: <Settings className="size-4" />,
  },
];

// ── Plan definitions ──────────────────────────────────────────────────────────

interface Plan {
  id: "starter" | "pro";
  name: string;
  price: string;
  description: string;
  badge?: string;
  features: string[];
}

const PLANS: Plan[] = [
  {
    id: "starter",
    name: "Starter",
    price: "$19",
    description: "Perfect for indie founders monitoring a handful of subreddits.",
    features: [
      "Up to 5 subreddits monitored",
      "Weekly digest of 5–10 ranked threads",
      "Buyer-intent scoring (0–100)",
      "False-positive feedback loop",
      "Email digest delivery",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: "$49",
    description: "For founders who want broader coverage and deeper signals.",
    badge: "Most popular",
    features: [
      "Up to 15 subreddits monitored",
      "Weekly digest of 5–10 ranked threads",
      "Buyer-intent scoring (0–100)",
      "False-positive feedback loop",
      "Email digest delivery",
      "Semantic query expansion (AI-powered)",
      "Reply scaffold per thread",
      "Priority support",
    ],
  },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function BillingPage() {
  const sessionData = await auth.api.getSession({ headers: await headers() });
  if (!sessionData?.session || !sessionData?.user) {
    redirect("/sign-in");
  }

  // Determine if there's a success/cancel query param to show feedback.
  // (We read via search params — since this is a server component we can pass
  // props from the page segment via Next.js searchParams.)

  return (
    <AppShell
      appName="ThreadHunter"
      nav={NAV}
      header={
        <PageHeader
          title="Upgrade Your Plan"
          description="Pick the plan that fits your outreach workflow. Billed monthly, cancel any time."
        />
      }
    >
      <div className="mx-auto max-w-3xl space-y-8 py-2">
        {/* Plan cards */}
        <div className="grid gap-6 sm:grid-cols-2">
          {PLANS.map((plan) => (
            <Card
              key={plan.id}
              className={
                plan.badge
                  ? "border-primary/50 shadow-md transition-shadow hover:shadow-lg"
                  : "transition-shadow hover:shadow-md"
              }
            >
              <CardHeader className="space-y-2 pb-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="font-display text-xl font-semibold">
                    {plan.name}
                  </CardTitle>
                  {plan.badge ? (
                    <Badge variant="default" className="text-xs">
                      <Zap className="mr-1 size-3" />
                      {plan.badge}
                    </Badge>
                  ) : null}
                </div>

                <div className="flex items-baseline gap-1">
                  <span className="font-mono text-3xl font-semibold tabular-nums">
                    {plan.price}
                  </span>
                  <span className="text-sm text-muted-foreground">/month</span>
                </div>

                <CardDescription>{plan.description}</CardDescription>
              </CardHeader>

              <CardContent className="pb-4">
                <ul className="space-y-2">
                  {plan.features.map((feat) => (
                    <li key={feat} className="flex items-start gap-2 text-sm">
                      <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>

              <CardFooter className="pt-0">
                <CheckoutButton
                  plan={plan.id}
                  label={`Upgrade to ${plan.name}`}
                  variant={plan.badge ? "default" : "outline"}
                />
              </CardFooter>
            </Card>
          ))}
        </div>

        {/* Trust copy */}
        <p className="text-center text-sm text-muted-foreground">
          Payments are processed securely by Stripe. You can cancel your
          subscription at any time from your billing portal.
        </p>
      </div>
    </AppShell>
  );
}

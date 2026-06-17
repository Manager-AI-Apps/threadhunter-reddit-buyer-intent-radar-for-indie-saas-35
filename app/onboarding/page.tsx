"use client";

/**
 * Onboarding page — first-time workspace setup.
 *
 * Collects 4 fields: product URL, product name, ICP description, and
 * 3–8 starter subreddits. On successful submission the server action
 * redirects to /dashboard.
 */

import * as React from "react";
import { useRouter } from "next/navigation";

import { createWorkspace } from "@/app/_actions/create-workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Return true if err is a Next.js server-redirect throw (so we let it propagate). */
function isNextRedirect(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "digest" in err &&
    typeof (err as { digest?: unknown }).digest === "string" &&
    ((err as { digest: string }).digest.startsWith("NEXT_REDIRECT") ||
      (err as { digest: string }).digest.startsWith("NEXT_NOT_FOUND"))
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const formData = new FormData(e.currentTarget);

    try {
      await createWorkspace(formData);
      // In production the server action calls redirect(), which throws NEXT_REDIRECT
      // and is handled by Next.js. In tests the mock resolves normally, so we push
      // programmatically here as a reliable signal.
      router.push("/dashboard");
    } catch (err) {
      // Let Next.js handle its own redirects.
      if (isNextRedirect(err)) throw err;
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-2xl">
        {/* Page header */}
        <div className="mb-8 text-center">
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            Set up your workspace
          </h1>
          <p className="mt-2 text-base text-muted-foreground">
            Tell us about your product and where your buyers hang out on Reddit.
            We&apos;ll watch those subs and surface the threads worth replying to.
          </p>
        </div>

        <Card className="rounded-xl border bg-card shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="font-display text-xl font-medium">
              Your product
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              Plain language is fine — we use this to generate semantic queries,
              not keywords.
            </CardDescription>
          </CardHeader>

          <CardContent>
            <form
              onSubmit={handleSubmit}
              aria-label="Workspace setup form"
              data-testid="onboarding-form"
              className="space-y-5"
              noValidate
            >
              {/* Product name */}
              <div className="space-y-2">
                <Label htmlFor="name">Product name</Label>
                <Input
                  id="name"
                  name="name"
                  type="text"
                  placeholder="e.g. ThreadHunter"
                  required
                  maxLength={100}
                />
              </div>

              {/* Product URL */}
              <div className="space-y-2">
                <Label htmlFor="productUrl">Product URL</Label>
                <Input
                  id="productUrl"
                  name="productUrl"
                  type="url"
                  placeholder="https://yourproduct.com"
                  required
                />
                <p className="text-sm text-muted-foreground">
                  Your product&apos;s public homepage or landing page.
                </p>
              </div>

              {/* ICP — Ideal Customer Profile */}
              <div className="space-y-2">
                <Label htmlFor="description">
                  Ideal customer profile (ICP)
                </Label>
                <Textarea
                  id="description"
                  name="description"
                  placeholder="e.g. Indie SaaS founders doing $1k–$30k MRR who spend 30 min/week searching Reddit manually for potential customers"
                  required
                  maxLength={1000}
                  rows={3}
                  className="resize-y"
                />
                <p className="text-sm text-muted-foreground">
                  Describe your target customer in plain language. This drives
                  the intent classifier.
                </p>
              </div>

              {/* Subreddits */}
              <div className="space-y-2">
                <Label htmlFor="subreddits">
                  Subreddits to watch{" "}
                  <span className="font-normal text-muted-foreground">
                    (3–8, comma-separated)
                  </span>
                </Label>
                <Input
                  id="subreddits"
                  name="subreddits"
                  type="text"
                  placeholder="r/SaaS, r/IndieHackers, r/entrepreneur"
                  required
                />
                <p className="text-sm text-muted-foreground">
                  The subreddits your buyers frequent. Prefix with{" "}
                  <code className="font-mono text-xs">r/</code> or just type the
                  name — we handle both.
                </p>
              </div>

              {/* Error message */}
              {error ? (
                <div
                  role="alert"
                  className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
                >
                  {error}
                </div>
              ) : null}

              <Button
                type="submit"
                className="w-full"
                disabled={loading}
              >
                {loading ? "Setting up your workspace…" : "Set up workspace"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

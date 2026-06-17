"use client";

/**
 * CheckoutButton — Client component that POSTs to /api/billing/checkout,
 * then redirects the browser to the Stripe-hosted checkout page.
 */

import * as React from "react";
import { Button } from "@/components/ui/button";

interface CheckoutButtonProps {
  plan: "starter" | "pro";
  label: string;
  variant?: "default" | "outline";
}

export function CheckoutButton({
  plan,
  label,
  variant = "default",
}: CheckoutButtonProps) {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });

      if (!res.ok) {
        const data = (await res.json()) as {
          error?: { message?: string };
        };
        throw new Error(data.error?.message ?? "Failed to start checkout.");
      }

      const { url } = (await res.json()) as { url: string };
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setLoading(false);
    }
  }

  return (
    <div>
      <Button
        variant={variant}
        onClick={handleClick}
        disabled={loading}
        className="w-full"
      >
        {loading ? "Redirecting…" : label}
      </Button>
      {error ? (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

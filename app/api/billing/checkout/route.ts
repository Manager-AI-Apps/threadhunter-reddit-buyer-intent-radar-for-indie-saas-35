/**
 * POST /api/billing/checkout
 *
 * Creates a Stripe Checkout session for the signed-in user.
 *
 * Request body: { plan: "starter" | "pro" }
 * Response:     { url: string }  — the Stripe-hosted checkout URL
 *
 * Auth: Better Auth session required (returns 401 otherwise).
 * Env:  STRIPE_SECRET_KEY, STRIPE_STARTER_PRICE_ID, STRIPE_PRO_PRICE_ID
 */

import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { z } from "zod/v4";

import { auth } from "@/lib/auth";
import { ApiError, handleRoute } from "@/lib/api-error";
import { requireEnv } from "@/lib/env";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const CheckoutSchema = z.object({
  plan: z.enum(["starter", "pro"]),
});

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export const POST = handleRoute(async (req: NextRequest) => {
  // 1. Auth check (reads env inside handler per robustness rules)
  const sessionData = await auth.api.getSession({ headers: await headers() });
  if (!sessionData?.session || !sessionData?.user) {
    throw new ApiError("unauthorized", "You must be signed in to upgrade.");
  }

  // 2. Parse & validate request body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ApiError("bad_request", "Request body must be valid JSON.");
  }

  const parsed = CheckoutSchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(
      "bad_request",
      "Invalid plan. Must be 'starter' or 'pro'.",
    );
  }

  const { plan } = parsed.data;

  // 3. Read Stripe config (inside handler so momentarily-unset vars don't
  //    throw at render/module-load time as per the robustness rules).
  const stripeSecretKey = requireEnv("STRIPE_SECRET_KEY");
  const priceId =
    plan === "starter"
      ? requireEnv("STRIPE_STARTER_PRICE_ID")
      : requireEnv("STRIPE_PRO_PRICE_ID");

  // 4. Build Stripe checkout session
  const stripe = new Stripe(stripeSecretKey, { apiVersion: "2025-02-24.acacia" });

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer_email: sessionData.user.email,
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    success_url: `${process.env.BETTER_AUTH_URL ?? "http://localhost:3000"}/billing?success=1`,
    cancel_url: `${process.env.BETTER_AUTH_URL ?? "http://localhost:3000"}/billing?canceled=1`,
    metadata: {
      userId: sessionData.user.id,
      plan,
    },
  });

  if (!session.url) {
    throw new ApiError("internal", "Stripe did not return a checkout URL.");
  }

  return NextResponse.json({ url: session.url });
});

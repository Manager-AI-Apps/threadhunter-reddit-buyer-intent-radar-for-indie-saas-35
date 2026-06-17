/**
 * POST /api/billing/webhook
 *
 * Stripe webhook endpoint. Reads the raw request body (not parsed JSON) and
 * validates the Stripe-Signature header via stripe.webhooks.constructEvent —
 * which uses HMAC-SHA256 with crypto.timingSafeEqual internally so the secret
 * is never compared directly via string equality (no timing oracle).
 *
 * Handled events:
 *   - checkout.session.completed     → upgrade workspace plan + subscription
 *   - customer.subscription.updated  → sync subscription status / downgrade
 */

import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { eq } from "drizzle-orm";

import { db as appDb, type Database } from "@/lib/db";
import { workspaces } from "@/lib/db/schema";
import type { WorkspacePlan } from "@/lib/db/schema";
import { ApiError, handleRoute } from "@/lib/api-error";
import { requireEnv } from "@/lib/env";

// ---------------------------------------------------------------------------
// Config — no Pages Router body-parser in App Router, but exporting the
// canonical config shape signals intent to callers and infrastructure tools.
// ---------------------------------------------------------------------------

export const config = {
  api: { bodyParser: false },
};

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export const POST = handleRoute(async (req: NextRequest) => {
  // 1. Read raw body — MUST be the raw string for HMAC verification.
  //    Never pass req.json() to constructEvent; the signature would not match.
  const rawBody = await req.text();

  // 2. Require the Stripe-Signature header
  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    throw new ApiError("bad_request", "Missing stripe-signature header.");
  }

  // 3. Load env inside handler (not at module level) per robustness rules
  const stripeSecretKey = requireEnv("STRIPE_SECRET_KEY");
  const webhookSecret = requireEnv("STRIPE_WEBHOOK_SECRET");

  const stripe = new Stripe(stripeSecretKey, { apiVersion: "2025-02-24.acacia" });

  // 4. Verify signature — constructEvent uses HMAC-SHA256 + crypto.timingSafeEqual
  //    internally. Never compare the raw sig/secret strings directly via `===`
  //    as that creates a timing oracle.
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    throw new ApiError(
      "bad_request",
      `Webhook signature verification failed: ${
        err instanceof Error ? err.message : "invalid signature"
      }`,
    );
  }

  // 5. Process the event against the database
  await processWebhookEvent(event, appDb);

  return NextResponse.json({ received: true });
});

// ---------------------------------------------------------------------------
// Event processor — exported for direct integration-test invocation with an
// injected test DB (avoids module-level vi.mock gymnastics).
// ---------------------------------------------------------------------------

export async function processWebhookEvent(
  event: Stripe.Event,
  dbInstance: Database = appDb,
): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;

      const userId = session.metadata?.userId;
      const plan = session.metadata?.plan as WorkspacePlan | undefined;
      const subscriptionId = resolveStripeId(session.subscription);
      const customerId = resolveStripeId(session.customer);

      // Guard: metadata must supply userId + a recognised plan
      if (!userId || !plan || !isValidPlan(plan)) return;

      await dbInstance
        .update(workspaces)
        .set({
          plan,
          stripeSubscriptionId: subscriptionId,
          stripeCustomerId: customerId,
          updatedAt: new Date(),
        })
        .where(eq(workspaces.userId, userId));

      break;
    }

    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      const subscriptionId = subscription.id;

      // Determine the effective plan after this subscription change.
      // Priority: canceled/unpaid → free; metadata.plan if set and valid.
      let newPlan: WorkspacePlan | undefined;

      if (
        subscription.status === "canceled" ||
        subscription.status === "unpaid"
      ) {
        newPlan = "free";
      } else {
        const metaPlan = subscription.metadata?.plan as
          | WorkspacePlan
          | undefined;
        if (metaPlan && isValidPlan(metaPlan)) newPlan = metaPlan;
      }

      await dbInstance
        .update(workspaces)
        .set({
          ...(newPlan !== undefined ? { plan: newPlan } : {}),
          stripeSubscriptionId: subscriptionId,
          updatedAt: new Date(),
        })
        .where(eq(workspaces.stripeSubscriptionId, subscriptionId));

      break;
    }

    default:
      // Unrecognised event — acknowledge receipt without acting
      break;
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Extracts a plain string ID from a Stripe field that may be an expanded
 * object, a bare ID string, or null/undefined.
 */
function resolveStripeId(
  value: string | { id: string } | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  return value.id;
}

function isValidPlan(plan: string): plan is WorkspacePlan {
  return plan === "free" || plan === "starter" || plan === "pro";
}

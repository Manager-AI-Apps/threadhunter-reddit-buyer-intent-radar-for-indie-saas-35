/**
 * Tests for POST /api/billing/webhook
 *
 * Acceptance tests:
 * 1. rejects invalid signature: constructEvent called with raw string body;
 *    invalid sig returns 400
 * 2. upgrades plan on event: valid checkout.session.completed event sets
 *    workspace.plan='starter' and updatedAt refreshed
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";

import { createTestDb } from "@/tests/helpers/test-db";
import { workspaces, user } from "@/lib/db/schema";

// ---------------------------------------------------------------------------
// Hoisted mock refs — must be hoisted before any import uses them
// ---------------------------------------------------------------------------

const { mockConstructEvent } = vi.hoisted(() => ({
  mockConstructEvent: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Stripe mock — prevents real network calls
// ---------------------------------------------------------------------------

vi.mock("stripe", () => ({
  default: vi.fn().mockImplementation(() => ({
    webhooks: {
      constructEvent: mockConstructEvent,
    },
  })),
}));

// ---------------------------------------------------------------------------
// Env stubs — inject dummy secrets so requireEnv succeeds
// ---------------------------------------------------------------------------

vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_dummy_for_webhook_tests");
vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test_dummy_for_webhook_tests");

// ---------------------------------------------------------------------------
// Imports after mocks are set up
// ---------------------------------------------------------------------------

import { POST, processWebhookEvent } from "@/app/api/billing/webhook/route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWebhookRequest(body: string, sig: string): NextRequest {
  return new NextRequest("http://localhost/api/billing/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "stripe-signature": sig,
    },
    body,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/billing/webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ------------------------------------------------------------------------
  // Unit: signature validation
  // ------------------------------------------------------------------------

  describe("unit: signature validation", () => {
    it("rejects invalid signature — returns 400 and calls constructEvent with raw string body", async () => {
      mockConstructEvent.mockImplementationOnce(() => {
        throw new Error(
          "No signatures found matching the expected signature for payload.",
        );
      });

      const rawBody = JSON.stringify({ type: "checkout.session.completed" });
      const req = makeWebhookRequest(rawBody, "t=1234,v1=invalid_sig");
      const res = await POST(req);

      expect(res.status).toBe(400);

      const json = (await res.json()) as { error: { code: string } };
      expect(json.error.code).toBe("bad_request");

      // Verify constructEvent was called with raw string body (not a parsed object)
      expect(mockConstructEvent).toHaveBeenCalledOnce();
      const [bodyArg] = mockConstructEvent.mock.calls[0] as [unknown, ...unknown[]];
      expect(typeof bodyArg).toBe("string");
      // Confirm the string matches the raw JSON we sent (not a parsed object)
      expect(JSON.parse(bodyArg as string)).toEqual({
        type: "checkout.session.completed",
      });
    });

    it("returns 400 when stripe-signature header is missing", async () => {
      const req = new NextRequest("http://localhost/api/billing/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "checkout.session.completed" }),
      });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: { code: string } };
      expect(json.error.code).toBe("bad_request");
    });
  });

  // ------------------------------------------------------------------------
  // Integration: plan upgrade persisted to DB
  // ------------------------------------------------------------------------

  describe("integration: plan upgrade", () => {
    let testDb: Awaited<ReturnType<typeof createTestDb>>;

    beforeEach(async () => {
      testDb = await createTestDb();
    });

    afterEach(async () => {
      await testDb.close();
    });

    it("upgrades plan on checkout.session.completed — sets plan='starter' and refreshes updatedAt", async () => {
      const userId = "usr_wh_test_001";
      const workspaceId = "ws_wh_test_001";
      const originalUpdatedAt = new Date(Date.now() - 60_000); // 1 minute ago

      // Seed: user + workspace with plan='free'
      await testDb.db.insert(user).values({
        id: userId,
        name: "Webhook Test User",
        email: "webhook-test@example.com",
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await testDb.db.insert(workspaces).values({
        id: workspaceId,
        userId,
        name: "My Startup",
        description: "An indie SaaS product",
        createdAt: new Date(),
        updatedAt: originalUpdatedAt,
      });

      // Confirm initial state
      const [before] = await testDb.db
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId));
      expect(before.plan).toBe("free");

      // Build a mock checkout.session.completed event
      const mockEvent = {
        type: "checkout.session.completed" as const,
        data: {
          object: {
            id: "cs_test_abc123",
            customer: "cus_test_stripe_123",
            subscription: "sub_test_starter_001",
            metadata: {
              userId,
              plan: "starter",
            },
          },
        },
      };

      // Call processWebhookEvent directly with testDb (no HTTP overhead,
      // no need to mock @/lib/db at the module level)
      await processWebhookEvent(
        mockEvent as unknown as import("stripe").default.Event,
        testDb.db,
      );

      // Verify workspace was upgraded
      const [after] = await testDb.db
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId));

      expect(after.plan).toBe("starter");
      expect(after.stripeSubscriptionId).toBe("sub_test_starter_001");
      expect(after.stripeCustomerId).toBe("cus_test_stripe_123");
      // updatedAt must be newer than the original (1 minute ago)
      expect(after.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
    });
  });
});

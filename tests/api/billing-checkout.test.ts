/**
 * Tests for POST /api/billing/checkout
 *
 * Acceptance tests:
 * 1. checkout requires auth — returns 401 when no session
 * 2. creates stripe session — mocked Stripe returns {url} to client
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Hoisted mock refs so they can be referenced inside vi.mock factories
// ---------------------------------------------------------------------------

const { mockGetSession, mockSessionsCreate } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockSessionsCreate: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Auth mock — controls whether a session exists for each test
// ---------------------------------------------------------------------------

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: mockGetSession,
    },
  },
}));

// ---------------------------------------------------------------------------
// next/headers mock — headers() is not available outside of Next.js runtime
// ---------------------------------------------------------------------------

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}));

// ---------------------------------------------------------------------------
// Stripe mock — prevents real network calls and lets us assert the URL
// ---------------------------------------------------------------------------

vi.mock("stripe", () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      checkout: {
        sessions: {
          create: mockSessionsCreate,
        },
      },
    })),
  };
});

// ---------------------------------------------------------------------------
// Env mock — inject dummy secrets so requireEnv succeeds in the route
// ---------------------------------------------------------------------------

vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_dummy_key_for_tests");
vi.stubEnv("STRIPE_STARTER_PRICE_ID", "price_starter_test");
vi.stubEnv("STRIPE_PRO_PRICE_ID", "price_pro_test");

// ---------------------------------------------------------------------------
// Import after mocks are set up
// ---------------------------------------------------------------------------

import { POST } from "@/app/api/billing/checkout/route";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/billing/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/billing/checkout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("checkout requires auth — returns 401 when no session", async () => {
    mockGetSession.mockResolvedValueOnce(null);

    const req = makeRequest({ plan: "starter" });
    const res = await POST(req);

    expect(res.status).toBe(401);
    const json = await res.json() as { error: { code: string; message: string } };
    expect(json.error.code).toBe("unauthorized");
  });

  it("creates stripe session — returns {url} for starter plan", async () => {
    mockGetSession.mockResolvedValueOnce({
      session: { id: "ses_111" },
      user: { id: "usr_001", email: "alice@example.com" },
    });

    const checkoutUrl = "https://checkout.stripe.com/pay/cs_test_abc123";
    mockSessionsCreate.mockResolvedValueOnce({ url: checkoutUrl });

    const req = makeRequest({ plan: "starter" });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const json = await res.json() as { url: string };
    expect(json.url).toBe(checkoutUrl);

    // Verify Stripe was called with the starter price
    expect(mockSessionsCreate).toHaveBeenCalledOnce();
    const callArgs = mockSessionsCreate.mock.calls[0][0] as {
      line_items: Array<{ price: string; quantity: number }>;
    };
    expect(callArgs.line_items[0].price).toBe("price_starter_test");
  });

  it("creates stripe session — returns {url} for pro plan", async () => {
    mockGetSession.mockResolvedValueOnce({
      session: { id: "ses_222" },
      user: { id: "usr_002", email: "bob@example.com" },
    });

    const checkoutUrl = "https://checkout.stripe.com/pay/cs_test_xyz789";
    mockSessionsCreate.mockResolvedValueOnce({ url: checkoutUrl });

    const req = makeRequest({ plan: "pro" });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const json = await res.json() as { url: string };
    expect(json.url).toBe(checkoutUrl);

    // Verify Stripe was called with the pro price
    const callArgs = mockSessionsCreate.mock.calls[0][0] as {
      line_items: Array<{ price: string; quantity: number }>;
    };
    expect(callArgs.line_items[0].price).toBe("price_pro_test");
  });

  it("returns 400 for invalid plan value", async () => {
    mockGetSession.mockResolvedValueOnce({
      session: { id: "ses_333" },
      user: { id: "usr_003", email: "carol@example.com" },
    });

    const req = makeRequest({ plan: "enterprise" });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const json = await res.json() as { error: { code: string } };
    expect(json.error.code).toBe("bad_request");
  });
});

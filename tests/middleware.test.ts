import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Edge-safe cookie-presence check (no DB import in middleware).
vi.mock("better-auth/cookies", () => ({
  getSessionCookie: vi.fn(),
}));

import { getSessionCookie } from "better-auth/cookies";
// Import after mocking so the module under test picks up the mock.
const { middleware } = await import("@/middleware");

describe("middleware – auth protection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── authenticated pass-through ─────────────────────────────────────────────

  it("allows through authenticated requests to /dashboard", () => {
    vi.mocked(getSessionCookie).mockReturnValue("session-token" as never);
    const req = new NextRequest("http://localhost:3000/dashboard");
    const res = middleware(req);
    expect(res.status).toBe(200); // NextResponse.next() -> 200
  });

  // ── unauthenticated redirects ──────────────────────────────────────────────

  it("middleware redirects unauthenticated: GET /dashboard without session cookie returns redirect to /sign-in", () => {
    vi.mocked(getSessionCookie).mockReturnValue(null as never);
    const req = new NextRequest("http://localhost:3000/dashboard");
    const res = middleware(req);

    expect(res.status).toBe(307);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/sign-in");
  });

  it("onboarding protected: GET /onboarding without session redirects to /sign-in", () => {
    vi.mocked(getSessionCookie).mockReturnValue(null as never);
    const req = new NextRequest("http://localhost:3000/onboarding");
    const res = middleware(req);

    expect(res.status).toBe(307);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/sign-in");
  });

  it("settings protected: GET /settings without session redirects to /sign-in", () => {
    vi.mocked(getSessionCookie).mockReturnValue(null as never);
    const req = new NextRequest("http://localhost:3000/settings");
    const res = middleware(req);

    expect(res.status).toBe(307);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/sign-in");
  });

  it("passes nested protected paths: /dashboard/some-page without session redirects", () => {
    vi.mocked(getSessionCookie).mockReturnValue(null as never);
    const req = new NextRequest("http://localhost:3000/dashboard/some-page");
    const res = middleware(req);

    expect(res.status).toBe(307);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/sign-in");
  });

  it("does not intercept public routes", () => {
    vi.mocked(getSessionCookie).mockReturnValue(null as never);
    const req = new NextRequest("http://localhost:3000/sign-in");
    const res = middleware(req);
    // Public — should pass through (200 from NextResponse.next())
    expect(res.status).toBe(200);
  });
});

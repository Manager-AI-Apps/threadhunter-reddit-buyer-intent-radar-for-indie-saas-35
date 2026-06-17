/**
 * Acceptance tests for POST /api/workspace/expand-queries
 *
 * Groups:
 * 1. Auth + ownership: 401 for no session; 403 for wrong workspace owner
 * 2. Persists expanded queries: stores 8-12 queries + refreshes updatedAt
 * 3. Rate limited: 6th request within 1 min → 429
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";

import { createTestDb } from "@/tests/helpers/test-db";
import { user, workspaces } from "@/lib/db/schema";
import { expandQueries } from "@/lib/queries/expand-queries";
import { POST } from "@/app/api/workspace/expand-queries/route";
import type { Database } from "@/lib/db";

// ── Module-level mocks (hoisted) ───────────────────────────────────────────────

let _testDb: Database;

vi.mock("@/lib/db", () => ({
  get db() {
    return _testDb;
  },
}));

const _mockGetSession = vi.fn();

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      get getSession() {
        return _mockGetSession;
      },
    },
  },
}));

// Auto-mock so OpenAI is never called in tests;
// individual tests override with mockImplementation as needed.
vi.mock("@/lib/queries/expand-queries");

// ── Shared helpers ─────────────────────────────────────────────────────────────

async function seedUserAndWorkspace(
  db: Database,
  opts: { updatedAt?: Date } = {},
) {
  const userId = crypto.randomUUID();
  const workspaceId = crypto.randomUUID();
  const timestamp = opts.updatedAt ?? new Date();

  await db.insert(user).values({
    id: userId,
    name: "Test Founder",
    email: `test-${userId}@example.com`,
    emailVerified: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  const [workspace] = await db
    .insert(workspaces)
    .values({
      id: workspaceId,
      userId,
      name: "Test Workspace",
      description: "Reddit monitoring for SaaS founders",
      productUrl: "https://example.com",
      subreddits: ["SaaS", "IndieHackers", "entrepreneur"],
      expandedQueries: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .returning();

  return { userId, workspace: workspace! };
}

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/workspace/expand-queries", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

// ── 1. Auth + ownership ────────────────────────────────────────────────────────

describe("POST /api/workspace/expand-queries — auth + ownership", () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;

  beforeEach(async () => {
    testDb = await createTestDb();
    _testDb = testDb.db;
    _mockGetSession.mockReset();
    vi.mocked(expandQueries).mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await testDb.close();
  });

  it("returns 401 for unauthenticated request", async () => {
    _mockGetSession.mockResolvedValue(null);

    const req = makeRequest({ workspaceId: "some-id" });
    const res = await POST(req);

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("unauthorized");
  });

  it("returns 403 when user does not own the workspace", async () => {
    const { workspace } = await seedUserAndWorkspace(testDb.db);

    const otherUserId = crypto.randomUUID();
    await testDb.db.insert(user).values({
      id: otherUserId,
      name: "Other User",
      email: `other-${otherUserId}@example.com`,
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    _mockGetSession.mockResolvedValue({
      session: { id: "session-other" },
      user: { id: otherUserId },
    });

    const req = makeRequest({ workspaceId: workspace.id });
    const res = await POST(req);

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("forbidden");
  });
});

// ── 2. Persists expanded queries ──────────────────────────────────────────────

describe("POST /api/workspace/expand-queries — persists expanded queries", () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;

  beforeEach(async () => {
    testDb = await createTestDb();
    _testDb = testDb.db;
    _mockGetSession.mockReset();
  });

  afterEach(async () => {
    await testDb.close();
  });

  it("stores 8-12 query strings in expandedQueries and refreshes updatedAt", async () => {
    // Seed with a timestamp clearly in the past so we can verify updatedAt advances
    const pastTime = new Date(Date.now() - 120_000); // 2 minutes ago
    const { userId, workspace } = await seedUserAndWorkspace(testDb.db, {
      updatedAt: pastTime,
    });

    _mockGetSession.mockResolvedValue({
      session: { id: "session-1" },
      user: { id: userId },
    });

    const fakeQueries = Array.from(
      { length: 10 },
      (_, i) => `semantic query ${i + 1}`,
    );
    const newUpdatedAt = new Date();

    vi.mocked(expandQueries).mockImplementation(async (workspaceId, db) => {
      await db!
        .update(workspaces)
        .set({ expandedQueries: fakeQueries, updatedAt: newUpdatedAt })
        .where(eq(workspaces.id, workspaceId));
    });

    const req = makeRequest({ workspaceId: workspace.id });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const resBody = (await res.json()) as { ok: boolean };
    expect(resBody.ok).toBe(true);

    const [updated] = await testDb.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, workspace.id));

    expect(updated?.expandedQueries).toHaveLength(10);
    expect(updated?.expandedQueries[0]).toBe("semantic query 1");
    // updatedAt should no longer equal the original past timestamp
    expect(updated?.updatedAt.getTime()).toBeGreaterThan(pastTime.getTime());
  });
});

// ── 3. Rate limited ───────────────────────────────────────────────────────────

describe("POST /api/workspace/expand-queries — rate limiting", () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;

  beforeEach(async () => {
    testDb = await createTestDb();
    _testDb = testDb.db;
    _mockGetSession.mockReset();
    vi.mocked(expandQueries).mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await testDb.close();
  });

  it("returns 429 on the 6th request within 1 minute", async () => {
    // Use a fresh userId per test run so rate-limit buckets never collide
    const rateLimitUserId = crypto.randomUUID();
    const now = new Date();

    await testDb.db.insert(user).values({
      id: rateLimitUserId,
      name: "RL User",
      email: `rl-${rateLimitUserId}@example.com`,
      emailVerified: false,
      createdAt: now,
      updatedAt: now,
    });

    const [rlWorkspace] = await testDb.db
      .insert(workspaces)
      .values({
        id: crypto.randomUUID(),
        userId: rateLimitUserId,
        name: "RL Workspace",
        description: "Test workspace for rate limiting",
        productUrl: "https://example.com",
        subreddits: ["SaaS", "test1", "test2"],
        expandedQueries: [],
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    _mockGetSession.mockResolvedValue({
      session: { id: "session-rl" },
      user: { id: rateLimitUserId },
    });

    // First 5 requests should succeed (limit = 5/min)
    for (let i = 0; i < 5; i++) {
      const req = makeRequest({ workspaceId: rlWorkspace!.id });
      const res = await POST(req);
      expect(res.status, `request ${i + 1} should succeed`).toBe(200);
    }

    // 6th request must be rate-limited
    const req = makeRequest({ workspaceId: rlWorkspace!.id });
    const res = await POST(req);
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("rate_limited");
  });
});

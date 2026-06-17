/**
 * Acceptance tests for markFalsePositive server action and
 * PATCH /api/threads/[id]/false-positive route.
 *
 * Tests:
 *  - marks false positive: owner marks thread as false positive; falsePositive=true in DB
 *  - rejects cross-user:   different user's session returns 403 and thread unchanged
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";

import { createTestDb } from "@/tests/helpers/test-db";
import { user, workspaces, threads } from "@/lib/db/schema";
import type { Database } from "@/lib/db";

// ── Module-level mocks ────────────────────────────────────────────────────────

// Mutable reference so the getter returns the freshly-created per-test db.
let _testDb: Database;

vi.mock("@/lib/db", () => ({
  get db() {
    return _testDb;
  },
}));

// Mutable mock for auth.api.getSession so individual tests control the value.
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

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// ── Seed helpers ─────────────────────────────────────────────────────────────

async function seedUser(
  db: Database,
  opts: { email?: string } = {},
): Promise<string> {
  const userId = crypto.randomUUID();
  const now = new Date();
  await db.insert(user).values({
    id: userId,
    name: "Test User",
    email: opts.email ?? `user-${userId}@threadhunter.test`,
    emailVerified: false,
    createdAt: now,
    updatedAt: now,
  });
  return userId;
}

async function seedWorkspace(db: Database, userId: string): Promise<string> {
  const workspaceId = crypto.randomUUID();
  const now = new Date();
  await db.insert(workspaces).values({
    id: workspaceId,
    userId,
    name: "Test Workspace",
    description: "Reddit monitoring SaaS",
    productUrl: "https://example.com",
    subreddits: ["SaaS"],
    expandedQueries: [],
    createdAt: now,
    updatedAt: now,
  });
  return workspaceId;
}

async function seedThread(db: Database, workspaceId: string): Promise<string> {
  const threadId = crypto.randomUUID();
  const now = new Date();
  await db.insert(threads).values({
    id: threadId,
    workspaceId,
    redditPostId: `post-${threadId}`,
    redditUrl: `https://reddit.com/r/SaaS/${threadId}`,
    title: "Looking for a Reddit monitoring tool",
    body: "",
    subreddit: "SaaS",
    intentLabel: "asking-for-recs",
    intentScore: 80,
    falsePositive: false,
    createdAt: now,
    updatedAt: now,
  });
  return threadId;
}

// ── Server action suite ───────────────────────────────────────────────────────

describe("markFalsePositive server action", () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;

  beforeEach(async () => {
    testDb = await createTestDb();
    _testDb = testDb.db;
    _mockGetSession.mockReset();
    // Reset module cache so the action picks up the fresh DB reference
    vi.resetModules();
  });

  afterEach(async () => {
    await testDb.close();
  });

  it("marks false positive: owner marks thread as false positive; falsePositive=true in DB", async () => {
    const userId = await seedUser(testDb.db);
    const workspaceId = await seedWorkspace(testDb.db, userId);
    const threadId = await seedThread(testDb.db, workspaceId);

    _mockGetSession.mockResolvedValue({
      session: { id: "sess-owner" },
      user: { id: userId },
    });

    const { markFalsePositive } = await import(
      "@/app/_actions/mark-false-positive"
    );
    const result = await markFalsePositive(threadId);

    // Typed result: { ok: true }
    expect(result).toMatchObject({ ok: true });

    // Verify the DB row was updated
    const [row] = await testDb.db
      .select({ falsePositive: threads.falsePositive })
      .from(threads)
      .where(eq(threads.id, threadId));

    expect(row?.falsePositive).toBe(true);
  });

  it("rejects unauthenticated call", async () => {
    const userId = await seedUser(testDb.db);
    const workspaceId = await seedWorkspace(testDb.db, userId);
    const threadId = await seedThread(testDb.db, workspaceId);

    _mockGetSession.mockResolvedValue(null);

    const { markFalsePositive } = await import(
      "@/app/_actions/mark-false-positive"
    );

    await expect(markFalsePositive(threadId)).rejects.toMatchObject({
      code: "unauthorized",
    });
  });

  it("rejects cross-user (server action): different user's session throws forbidden", async () => {
    // Seed the target thread owned by user1
    const userId1 = await seedUser(testDb.db, {
      email: "user1@threadhunter.test",
    });
    const workspaceId1 = await seedWorkspace(testDb.db, userId1);
    const threadId = await seedThread(testDb.db, workspaceId1);

    // user2 has their own workspace but tries to touch user1's thread
    const userId2 = await seedUser(testDb.db, {
      email: "user2@threadhunter.test",
    });
    await seedWorkspace(testDb.db, userId2);

    _mockGetSession.mockResolvedValue({
      session: { id: "sess-cross" },
      user: { id: userId2 },
    });

    const { markFalsePositive } = await import(
      "@/app/_actions/mark-false-positive"
    );

    await expect(markFalsePositive(threadId)).rejects.toMatchObject({
      code: "forbidden",
    });

    // Thread must remain unchanged
    const [row] = await testDb.db
      .select({ falsePositive: threads.falsePositive })
      .from(threads)
      .where(eq(threads.id, threadId));

    expect(row?.falsePositive).toBe(false);
  });
});

// ── HTTP route suite ──────────────────────────────────────────────────────────

describe("PATCH /api/threads/[id]/false-positive", () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;

  beforeEach(async () => {
    testDb = await createTestDb();
    _testDb = testDb.db;
    _mockGetSession.mockReset();
    vi.resetModules();
  });

  afterEach(async () => {
    await testDb.close();
  });

  it("marks false positive: returns 200 and sets falsePositive=true in DB", async () => {
    const userId = await seedUser(testDb.db);
    const workspaceId = await seedWorkspace(testDb.db, userId);
    const threadId = await seedThread(testDb.db, workspaceId);

    _mockGetSession.mockResolvedValue({
      session: { id: "sess-route-owner" },
      user: { id: userId },
    });

    const { PATCH } = await import(
      "@/app/api/threads/[id]/false-positive/route"
    );

    const req = new NextRequest(
      `http://localhost/api/threads/${threadId}/false-positive`,
      { method: "PATCH" },
    );

    const res = await PATCH(req, { params: Promise.resolve({ id: threadId }) });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; threadId: string };
    expect(body.ok).toBe(true);
    expect(body.threadId).toBe(threadId);

    // Verify DB update
    const [row] = await testDb.db
      .select({ falsePositive: threads.falsePositive })
      .from(threads)
      .where(eq(threads.id, threadId));

    expect(row?.falsePositive).toBe(true);
  });

  it("rejects cross-user: different user's session returns 403 and thread unchanged", async () => {
    // Seed target thread for user1
    const userId1 = await seedUser(testDb.db, {
      email: "route1@threadhunter.test",
    });
    const workspaceId1 = await seedWorkspace(testDb.db, userId1);
    const threadId = await seedThread(testDb.db, workspaceId1);

    // user2 authenticates but tries to mark user1's thread
    const userId2 = await seedUser(testDb.db, {
      email: "route2@threadhunter.test",
    });
    await seedWorkspace(testDb.db, userId2);

    _mockGetSession.mockResolvedValue({
      session: { id: "sess-route-cross" },
      user: { id: userId2 },
    });

    const { PATCH } = await import(
      "@/app/api/threads/[id]/false-positive/route"
    );

    const req = new NextRequest(
      `http://localhost/api/threads/${threadId}/false-positive`,
      { method: "PATCH" },
    );

    const res = await PATCH(req, { params: Promise.resolve({ id: threadId }) });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("forbidden");

    // Thread must be unchanged
    const [row] = await testDb.db
      .select({ falsePositive: threads.falsePositive })
      .from(threads)
      .where(eq(threads.id, threadId));

    expect(row?.falsePositive).toBe(false);
  });
});

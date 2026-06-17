/**
 * Acceptance tests for POST /api/ingest
 *
 * Three test groups:
 * 1. rejects wrong secret → 401
 * 2. inserts threads deduped → unique constraint ensures exactly one row
 * 3. uses expandedQueries in classifier → classifyFn receives workspace queries
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

import { createTestDb } from "@/tests/helpers/test-db";
import { runIngest, insertThread } from "@/lib/queries/threads";
import { POST } from "@/app/api/ingest/route";
import { user, workspaces, threads } from "@/lib/db/schema";
import type { RedditPost } from "@/lib/reddit-client";
import type { ClassificationResult } from "@/lib/intent-classifier";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TEST_INGEST_SECRET = "ingest-test-secret-xyz";

const mockPost: RedditPost = {
  id: "post-abc123",
  title: "Looking for a Reddit monitoring tool",
  selftext: "I want something to track brand mentions on Reddit",
  author: "testfounder",
  url: "https://reddit.com/r/SaaS/comments/post-abc123",
  created_utc: 1700000000,
};

const mockClassification: ClassificationResult = {
  label: "asking-for-recs",
  score: 82,
  suggestedAngle: "Offer ThreadHunter as the perfect solution",
  replyScaffold:
    "Hey! I built ThreadHunter specifically for this use case — happy to share more.",
};

const mockFetchPosts = vi.fn().mockResolvedValue([mockPost]);
const mockClassifyFn = vi.fn().mockResolvedValue(mockClassification);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Insert a test user and workspace, returns the workspace row */
async function seedWorkspace(
  db: Awaited<ReturnType<typeof createTestDb>>["db"],
  options: {
    subreddits?: string[];
    expandedQueries?: string[];
  } = {},
) {
  const userId = crypto.randomUUID();
  const workspaceId = crypto.randomUUID();
  const now = new Date();

  await db.insert(user).values({
    id: userId,
    name: "Test Founder",
    email: `test-${userId}@example.com`,
    emailVerified: false,
    createdAt: now,
    updatedAt: now,
  });

  const [workspace] = await db
    .insert(workspaces)
    .values({
      id: workspaceId,
      userId,
      name: "ThreadHunter Test",
      description: "Reddit monitoring for SaaS",
      productUrl: "https://example.com",
      subreddits: options.subreddits ?? ["SaaS"],
      expandedQueries: options.expandedQueries ?? [],
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return workspace!;
}

// ── 1. Rejects wrong secret ───────────────────────────────────────────────────

describe("POST /api/ingest — secret validation", () => {
  beforeEach(() => {
    process.env.INGEST_SECRET = TEST_INGEST_SECRET;
  });

  afterEach(() => {
    delete process.env.INGEST_SECRET;
  });

  it("rejects wrong secret", async () => {
    const req = new NextRequest("http://localhost/api/ingest", {
      method: "POST",
      headers: { "x-ingest-secret": "totally-wrong-value" },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("unauthorized");
  });

  it("rejects missing secret header", async () => {
    const req = new NextRequest("http://localhost/api/ingest", {
      method: "POST",
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});

// ── 2. Inserts threads deduped ────────────────────────────────────────────────

describe("runIngest — deduplication", () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;

  beforeEach(async () => {
    testDb = await createTestDb();
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    await testDb.close();
  });

  it("inserts threads deduped: concurrent ingest calls produce exactly one thread row", async () => {
    const workspace = await seedWorkspace(testDb.db, {
      subreddits: ["SaaS"],
    });

    const fetchFn = vi.fn().mockResolvedValue([mockPost]);
    const classifyFn = vi.fn().mockResolvedValue(mockClassification);

    // Simulate two concurrent ingest calls for the same workspace + post
    const [r1, r2] = await Promise.all([
      runIngest({
        db: testDb.db,
        workspaceId: workspace.id,
        fetchPosts: fetchFn,
        classifyFn,
      }),
      runIngest({
        db: testDb.db,
        workspaceId: workspace.id,
        fetchPosts: fetchFn,
        classifyFn,
      }),
    ]);

    // Combined result: exactly one insert across both calls
    expect(r1.inserted + r2.inserted).toBe(1);
    expect(r1.skipped + r2.skipped).toBe(1);

    const rows = await testDb.db.select().from(threads);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.redditPostId).toBe(mockPost.id);
    expect(rows[0]!.workspaceId).toBe(workspace.id);
  });

  it("insertThread returns false on duplicate without throwing", async () => {
    const workspace = await seedWorkspace(testDb.db);

    const base = {
      workspaceId: workspace.id,
      redditPostId: "dup-post-001",
      redditUrl: "https://reddit.com/r/SaaS/dup-post-001",
      title: "Test post",
      body: "",
      subreddit: "SaaS",
      intentLabel: "asking-for-recs" as const,
      intentScore: 70,
    };

    const first = await insertThread(testDb.db, base);
    const second = await insertThread(testDb.db, base);

    expect(first).toBe(true);
    expect(second).toBe(false);

    const rows = await testDb.db.select().from(threads);
    expect(rows).toHaveLength(1);
  });
});

// ── 3. Uses expandedQueries in classifier ─────────────────────────────────────

describe("runIngest — expandedQueries passed to classifier", () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;

  beforeEach(async () => {
    testDb = await createTestDb();
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    await testDb.close();
  });

  it("uses expandedQueries in classifier: prompt includes workspace query strings", async () => {
    const expandedQueries = [
      "reddit monitoring tool SaaS",
      "brand mention tracking software",
      "find customers on Reddit",
    ];

    const workspace = await seedWorkspace(testDb.db, {
      subreddits: ["SaaS"],
      expandedQueries,
    });

    const fetchFn = vi.fn().mockResolvedValue([mockPost]);
    const classifySpy = vi.fn().mockResolvedValue(mockClassification);

    await runIngest({
      db: testDb.db,
      workspaceId: workspace.id,
      fetchPosts: fetchFn,
      classifyFn: classifySpy,
    });

    expect(classifySpy).toHaveBeenCalledOnce();
    expect(classifySpy).toHaveBeenCalledWith(mockPost, expandedQueries);
  });
});

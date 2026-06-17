/**
 * Acceptance tests for POST /api/digest/send
 *
 * Three test groups:
 * 1. rejects wrong secret  → 401
 * 2. digest persists run + threads → digest_run row + digest_run_threads + digestSentAt set
 * 3. email contains thread data → digest-template renders title, intentLabel, replyScaffold
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { eq, isNull } from "drizzle-orm";

import { createTestDb } from "@/tests/helpers/test-db";
import { POST } from "@/app/api/digest/send/route";
import {
  user,
  workspaces,
  threads,
  digestRuns,
  digestRunThreads,
} from "@/lib/db/schema";
import { renderDigestEmail, type DigestThread } from "@/lib/email/digest-template";

// ── Mock Resend ───────────────────────────────────────────────────────────────

vi.mock("resend", () => {
  return {
    Resend: vi.fn().mockImplementation(() => ({
      emails: {
        send: vi.fn().mockResolvedValue({ data: { id: "mock-email-id" }, error: null }),
      },
    })),
  };
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TEST_SECRET = "digest-test-secret-xyz";

/** Insert a test user + workspace + threads, returns ids. */
async function seedData(
  db: Awaited<ReturnType<typeof createTestDb>>["db"],
  opts: { threadCount?: number } = {},
) {
  const userId = crypto.randomUUID();
  const workspaceId = crypto.randomUUID();
  const now = new Date();

  await db.insert(user).values({
    id: userId,
    name: "Test Founder",
    email: `founder-${userId}@example.com`,
    emailVerified: false,
    createdAt: now,
    updatedAt: now,
  });

  const [workspace] = await db
    .insert(workspaces)
    .values({
      id: workspaceId,
      userId,
      name: "ThreadHunter Workspace",
      description: "Find buyers on Reddit",
      productUrl: "https://threadhunter.example.com",
      subreddits: ["SaaS"],
      expandedQueries: [],
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  const threadCount = opts.threadCount ?? 3;
  const insertedThreads = [];
  for (let i = 0; i < threadCount; i++) {
    const [thread] = await db
      .insert(threads)
      .values({
        id: crypto.randomUUID(),
        workspaceId,
        redditPostId: `post-${i}`,
        redditUrl: `https://reddit.com/r/SaaS/comments/post-${i}`,
        title: `Looking for a great SaaS tool #${i}`,
        body: `I want something that does X and Y - post ${i}`,
        subreddit: "SaaS",
        intentLabel: "asking-for-recs",
        intentScore: 80 - i * 5,
        suggestedAngle: `Angle for post ${i}`,
        replyScaffold: `Hi! I built ThreadHunter for this — post ${i}`,
        falsePositive: false,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    insertedThreads.push(thread!);
  }

  return { userId, workspaceId, workspace: workspace!, threads: insertedThreads };
}

// ── 1. Rejects wrong secret ───────────────────────────────────────────────────

describe("POST /api/digest/send — secret validation", () => {
  beforeEach(() => {
    process.env.INGEST_SECRET = TEST_SECRET;
    process.env.RESEND_API_KEY = "re_test_key_xyz";
    process.env.DIGEST_FROM_EMAIL = "digest@example.com";
  });

  afterEach(() => {
    delete process.env.INGEST_SECRET;
    delete process.env.RESEND_API_KEY;
    delete process.env.DIGEST_FROM_EMAIL;
    vi.restoreAllMocks();
  });

  it("rejects wrong secret", async () => {
    const req = new NextRequest("http://localhost/api/digest/send", {
      method: "POST",
      headers: {
        "x-ingest-secret": "totally-wrong-value",
        "content-type": "application/json",
      },
      body: JSON.stringify({ workspaceId: "some-id" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("unauthorized");
  });

  it("rejects missing secret header", async () => {
    const req = new NextRequest("http://localhost/api/digest/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId: "some-id" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});

// ── 2. Digest persists run + threads ─────────────────────────────────────────

describe("POST /api/digest/send — persists digest run + threads", () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;

  beforeEach(async () => {
    testDb = await createTestDb();
    process.env.INGEST_SECRET = TEST_SECRET;
    process.env.RESEND_API_KEY = "re_test_key_xyz";
    process.env.DIGEST_FROM_EMAIL = "digest@example.com";
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    await testDb.close();
    delete process.env.INGEST_SECRET;
    delete process.env.RESEND_API_KEY;
    delete process.env.DIGEST_FROM_EMAIL;
  });

  it("digest persists run + threads: digest_run row + digest_run_threads + digestSentAt set", async () => {
    const { workspaceId, threads: seededThreads } = await seedData(testDb.db, {
      threadCount: 3,
    });

    // Import the route's sendDigest fn and pass testDb + no-op sendEmail for integration
    const { sendDigest } = await import("@/app/api/digest/send/route");

    await sendDigest({ workspaceId, db: testDb.db, sendEmail: async () => {} });

    // digest_runs row created
    const runs = await testDb.db
      .select()
      .from(digestRuns)
      .where(eq(digestRuns.workspaceId, workspaceId));
    expect(runs).toHaveLength(1);
    const run = runs[0]!;
    expect(run.workspaceId).toBe(workspaceId);

    // digest_run_threads rows created (one per thread)
    const joinRows = await testDb.db
      .select()
      .from(digestRunThreads)
      .where(eq(digestRunThreads.digestRunId, run.id));
    expect(joinRows.length).toBeGreaterThanOrEqual(1);
    expect(joinRows.length).toBeLessThanOrEqual(10);

    // threads.digestSentAt is set
    const threadIds = seededThreads.map((t) => t.id);
    const updatedThreads = await testDb.db
      .select()
      .from(threads)
      .where(eq(threads.workspaceId, workspaceId));

    const notSent = updatedThreads.filter((t) => threadIds.includes(t.id) && t.digestSentAt === null);
    expect(notSent).toHaveLength(0);
  });

  it("threads already sent are excluded from digest", async () => {
    const { workspaceId } = await seedData(testDb.db, { threadCount: 3 });
    const { sendDigest } = await import("@/app/api/digest/send/route");

    const noopEmail = async () => {};
    // Run digest twice
    await sendDigest({ workspaceId, db: testDb.db, sendEmail: noopEmail });
    await sendDigest({ workspaceId, db: testDb.db, sendEmail: noopEmail });

    // Second run should have no threads (all were already sent)
    const runs = await testDb.db
      .select()
      .from(digestRuns)
      .where(eq(digestRuns.workspaceId, workspaceId));
    expect(runs).toHaveLength(2);

    const secondRunId = runs[1]!.id;
    const secondRunJoins = await testDb.db
      .select()
      .from(digestRunThreads)
      .where(eq(digestRunThreads.digestRunId, secondRunId));
    expect(secondRunJoins).toHaveLength(0);
  });
});

// ── 3. Email contains thread data ─────────────────────────────────────────────

describe("renderDigestEmail — thread data rendered in template", () => {
  const sampleThreads: DigestThread[] = [
    {
      id: "th-1",
      title: "Best Reddit monitoring SaaS tools?",
      intentLabel: "asking-for-recs",
      intentScore: 92,
      suggestedAngle: "Position as the most focused intent tool",
      replyScaffold: "Hey! I've built exactly this — ThreadHunter tracks intent not keywords.",
      redditUrl: "https://reddit.com/r/SaaS/comments/abc123",
    },
    {
      id: "th-2",
      title: "F5Bot has too many false positives",
      intentLabel: "complaining-about-incumbent",
      intentScore: 78,
      suggestedAngle: null,
      replyScaffold: null,
      redditUrl: "https://reddit.com/r/SaaS/comments/def456",
    },
  ];

  it("renders title, intentLabel, replyScaffold as text without dangerouslySetInnerHTML", () => {
    const html = renderDigestEmail(sampleThreads, "My Workspace");

    // Title present
    expect(html).toContain("Best Reddit monitoring SaaS tools?");
    // intentLabel present
    expect(html).toContain("asking-for-recs");
    // replyScaffold present (as text)
    expect(html).toContain("Hey! I&#x27;ve built exactly this");
    // Score present
    expect(html).toContain("92");
    // Reddit URL present
    expect(html).toContain("https://reddit.com/r/SaaS/comments/abc123");
    // Second thread title
    expect(html).toContain("F5Bot has too many false positives");
    // intentLabel for second
    expect(html).toContain("complaining-about-incumbent");
    // Workspace name
    expect(html).toContain("My Workspace");
  });

  it("handles null suggestedAngle and replyScaffold gracefully", () => {
    const threads: DigestThread[] = [
      {
        id: "th-3",
        title: "No scaffold thread",
        intentLabel: "comparing-tools",
        intentScore: 60,
        suggestedAngle: null,
        replyScaffold: null,
        redditUrl: "https://reddit.com/r/SaaS/comments/ghi789",
      },
    ];

    expect(() => renderDigestEmail(threads, "Test Workspace")).not.toThrow();
    const html = renderDigestEmail(threads, "Test Workspace");
    expect(html).toContain("No scaffold thread");
    expect(html).toContain("comparing-tools");
  });
});

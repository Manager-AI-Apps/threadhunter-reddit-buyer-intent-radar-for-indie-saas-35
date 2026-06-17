/**
 * Integration tests for updateSubreddits server action.
 *
 * Acceptance tests:
 *  - updateSubreddits persists: saves new subreddit list and updatedAt is refreshed
 *  - unauthenticated rejected: updateSubreddits without session throws auth error
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";

import { createTestDb } from "@/tests/helpers/test-db";
import { user, workspaces } from "@/lib/db/schema";
import type { Database } from "@/lib/db";

// ── Module-level mocks ─────────────────────────────────────────────────────────

/** Mutable reference so the module-level getter always returns the fresh test db. */
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

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  useRouter: () => ({ push: vi.fn() }),
}));

// ── Helpers ────────────────────────────────────────────────────────────────────

const TEST_USER_ID = "usr_settings_001";
const TEST_WORKSPACE_ID = "ws_settings_001";

async function seedUserAndWorkspace(db: Database) {
  const now = new Date(Date.now() - 5000); // 5 s in the past so updatedAt refresh is detectable
  await db.insert(user).values({
    id: TEST_USER_ID,
    name: "Settings Tester",
    email: "settings@threadhunter.test",
    emailVerified: false,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(workspaces).values({
    id: TEST_WORKSPACE_ID,
    userId: TEST_USER_ID,
    name: "My SaaS",
    description: "Indie SaaS founders",
    productUrl: "https://example.com",
    subreddits: ["SaaS", "IndieHackers"],
    expandedQueries: [],
    createdAt: now,
    updatedAt: now,
  });
}

// ── updateSubreddits persists ──────────────────────────────────────────────────

describe("updateSubreddits persists", () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;

  beforeEach(async () => {
    testDb = await createTestDb();
    _testDb = testDb.db;
    _mockGetSession.mockReset();
  });

  afterEach(async () => {
    await testDb.close();
  });

  it("saves new subreddit list and refreshes updatedAt", async () => {
    await seedUserAndWorkspace(testDb.db);

    // Capture original updatedAt
    const [original] = await testDb.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, TEST_WORKSPACE_ID));
    const originalUpdatedAt = original?.updatedAt;
    expect(originalUpdatedAt).toBeInstanceOf(Date);

    // Simulate authenticated session
    _mockGetSession.mockResolvedValue({
      session: { id: "sess_001", userId: TEST_USER_ID },
      user: { id: TEST_USER_ID, email: "settings@threadhunter.test" },
    });

    // Import the action (dynamic to ensure mocks are in place)
    const { updateSubreddits } = await import(
      "@/app/_actions/update-workspace-settings"
    );

    const formData = new FormData();
    formData.set("workspaceId", TEST_WORKSPACE_ID);
    formData.set("subreddits", "SaaS, IndieHackers, entrepreneur, startups");

    const result = await updateSubreddits(formData);

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();

    // Verify the row was actually updated in the DB
    const [updated] = await testDb.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, TEST_WORKSPACE_ID));

    expect(updated).toBeDefined();
    expect(updated?.subreddits).toEqual(
      expect.arrayContaining(["SaaS", "IndieHackers", "entrepreneur", "startups"]),
    );
    expect(updated?.subreddits).toHaveLength(4);

    // updatedAt must have been refreshed (later than the seeded value)
    expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(
      originalUpdatedAt!.getTime(),
    );
  });
});

// ── unauthenticated rejected ───────────────────────────────────────────────────

describe("unauthenticated rejected", () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;

  beforeEach(async () => {
    testDb = await createTestDb();
    _testDb = testDb.db;
    _mockGetSession.mockReset();
  });

  afterEach(async () => {
    await testDb.close();
  });

  it("updateSubreddits without session throws auth error", async () => {
    _mockGetSession.mockResolvedValue(null);

    const { updateSubreddits } = await import(
      "@/app/_actions/update-workspace-settings"
    );

    const formData = new FormData();
    formData.set("workspaceId", TEST_WORKSPACE_ID);
    formData.set("subreddits", "SaaS, IndieHackers");

    await expect(updateSubreddits(formData)).rejects.toMatchObject({
      code: "unauthorized",
    });
  });
});

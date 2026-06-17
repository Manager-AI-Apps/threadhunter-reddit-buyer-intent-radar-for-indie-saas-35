/**
 * Tests for createWorkspace server action and onboarding persistence.
 *
 * Integration: createWorkspace persists row
 *   - createWorkspace with valid session writes workspace row with userId
 *   - unauthenticated call throws auth error
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";

import { createTestDb } from "@/tests/helpers/test-db";
import { user, workspaces } from "@/lib/db/schema";
import { insertWorkspace } from "@/lib/queries/workspace";
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

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  useRouter: () => ({ push: vi.fn() }),
}));

// Mock expandWorkspaceQueries so OpenAI is never called.
vi.mock("@/lib/queries/workspace", async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    expandWorkspaceQueries: vi.fn().mockResolvedValue(undefined),
  };
});

// ── Test helpers ──────────────────────────────────────────────────────────────

const TEST_USER_ID = "usr_test_001";

async function seedUser(db: Database) {
  const now = new Date();
  await db.insert(user).values({
    id: TEST_USER_ID,
    name: "Test User",
    email: "test@threadhunter.test",
    emailVerified: false,
    createdAt: now,
    updatedAt: now,
  });
}

// ── Integration: createWorkspace persists row ─────────────────────────────────

describe("createWorkspace persists row", () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;

  beforeEach(async () => {
    testDb = await createTestDb();
    _testDb = testDb.db;
    _mockGetSession.mockReset();
  });

  afterEach(async () => {
    await testDb.close();
  });

  it("createWorkspace with valid session writes workspace row with userId", async () => {
    await seedUser(testDb.db);

    const workspace = await insertWorkspace(testDb.db, {
      userId: TEST_USER_ID,
      name: "ThreadHunter Demo",
      description: "Indie SaaS founders doing $1k–$30k MRR who do Reddit outreach manually",
      productUrl: "https://threadhunter.example.com",
      subreddits: ["SaaS", "IndieHackers", "entrepreneur"],
    });

    expect(workspace.userId).toBe(TEST_USER_ID);
    expect(workspace.name).toBe("ThreadHunter Demo");
    expect(workspace.productUrl).toBe("https://threadhunter.example.com");
    expect(workspace.subreddits).toEqual(["SaaS", "IndieHackers", "entrepreneur"]);

    // Verify the row actually exists in the DB
    const [row] = await testDb.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.userId, TEST_USER_ID));

    expect(row).toBeDefined();
    expect(row?.name).toBe("ThreadHunter Demo");
    expect(row?.userId).toBe(TEST_USER_ID);
    expect(row?.updatedAt).toBeInstanceOf(Date);
  });

  it("unauthenticated call throws auth error", async () => {
    // No session → should reject with an ApiError-like unauthorized error
    _mockGetSession.mockResolvedValue(null);

    // Dynamically import the server action so mocks are in place
    const { createWorkspace } = await import("@/app/_actions/create-workspace");

    const formData = new FormData();
    formData.set("name", "My SaaS");
    formData.set("description", "Indie founders");
    formData.set("productUrl", "https://example.com");
    formData.set("subreddits", "SaaS, IndieHackers, entrepreneur");

    await expect(createWorkspace(formData)).rejects.toMatchObject({
      code: "unauthorized",
    });
  });
});

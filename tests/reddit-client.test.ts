import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// vi.mock is hoisted — env is mocked before the module under test loads
vi.mock("@/lib/env", () => ({
  requireEnv: (name: string): string => {
    const vars: Record<string, string> = {
      REDDIT_CLIENT_ID: "test-client-id",
      REDDIT_CLIENT_SECRET: "test-client-secret",
      REDDIT_USER_AGENT: "test-agent/1.0",
    };
    const value = vars[name];
    if (value === undefined) throw new Error(`Missing env: ${name}`);
    return value;
  },
  optionalEnv: (_name: string) => undefined,
}));

import {
  getToken,
  fetchSubredditNew,
  resetTokenCache,
  type RedditPost,
} from "@/lib/reddit-client";

// --- helpers ----------------------------------------------------------------

function tokenResponse(accessToken = "test-access-token", expiresIn = 3600) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ access_token: accessToken, expires_in: expiresIn }),
  } as unknown as Response;
}

function listingResponse(posts: RedditPost[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      data: {
        children: posts.map((p) => ({ data: p })),
      },
    }),
  } as unknown as Response;
}

// --- lifecycle --------------------------------------------------------------

beforeEach(() => {
  resetTokenCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// --- tests ------------------------------------------------------------------

describe("getToken — caching", () => {
  it("second call within expiry window does not re-fetch", async () => {
    const mockFetch = vi.fn().mockResolvedValue(tokenResponse());
    vi.stubGlobal("fetch", mockFetch);

    await getToken();
    await getToken();

    // Token should have been fetched only once; second call used the cache
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe("fetchSubredditNew — response parsing", () => {
  it("returns typed RedditPost[] parsed from Reddit listing JSON", async () => {
    const samplePost: RedditPost = {
      id: "abc123",
      title: "Looking for a SaaS tool",
      selftext: "Need something that does X",
      author: "testuser",
      url: "https://reddit.com/r/saas/abc123",
      created_utc: 1700000000,
    };

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse()) // OAuth token fetch
      .mockResolvedValueOnce(listingResponse([samplePost])); // subreddit listing
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchSubredditNew("saas", 1);

    expect(result).toHaveLength(1);
    expect(result[0]).toStrictEqual(samplePost);
  });
});

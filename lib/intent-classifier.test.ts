import { describe, it, expect, vi, afterEach } from "vitest";

// vi.mock is hoisted — env is mocked before the module under test loads
vi.mock("@/lib/env", () => ({
  requireEnv: (name: string): string => {
    const vars: Record<string, string> = {
      OPENAI_API_KEY: "test-openai-key",
    };
    const value = vars[name];
    if (value === undefined) throw new Error(`Missing env: ${name}`);
    return value;
  },
}));

import {
  classifyPost,
  type ClassificationResult,
} from "@/lib/intent-classifier";
import type { RedditPost } from "@/lib/reddit-client";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const samplePost: RedditPost = {
  id: "abc123",
  title: "Best project management tools for small teams?",
  selftext: "I'm looking for recommendations on project management software",
  author: "testuser",
  url: "https://reddit.com/r/projectmanagement/comments/abc123",
  created_utc: 1700000000,
};

const expandedQueries = ["project management software", "task tracking tools"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function openAIResponse(result: ClassificationResult): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify(result),
          },
        },
      ],
    }),
  } as unknown as Response;
}

function errorResponse(status: number): Response {
  return {
    ok: false,
    status,
    statusText: `Error ${status}`,
    json: async () => ({ error: { message: "Server error" } }),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("classifyPost — classifies post", () => {
  it("returns typed ClassificationResult with label and score 0-100", async () => {
    const expected: ClassificationResult = {
      label: "asking-for-recs",
      score: 85,
      suggestedAngle: "Introduce your PM tool as perfect for small teams",
      replyScaffold:
        "Hi! I built [Product] which is designed specifically for small teams...",
    };

    const mockFetch = vi.fn().mockResolvedValue(openAIResponse(expected));
    vi.stubGlobal("fetch", mockFetch);

    const result = await classifyPost(samplePost, expandedQueries);

    expect(result.label).toBe("asking-for-recs");
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.score).toBe(85);
    expect(typeof result.suggestedAngle).toBe("string");
    expect(typeof result.replyScaffold).toBe("string");
    expect(result.suggestedAngle.length).toBeGreaterThan(0);
    expect(result.replyScaffold.length).toBeGreaterThan(0);
  });
});

describe("classifyPost — retries on 5xx", () => {
  it("resolves on third attempt after two 500 responses", async () => {
    const expected: ClassificationResult = {
      label: "comparing-tools",
      score: 60,
      suggestedAngle: "Highlight key differentiators vs competitors",
      replyScaffold:
        "When comparing tools, [Product] stands out because of ...",
    };

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(500))
      .mockResolvedValueOnce(errorResponse(500))
      .mockResolvedValueOnce(openAIResponse(expected));
    vi.stubGlobal("fetch", mockFetch);

    const result = await classifyPost(samplePost, expandedQueries);

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(result.label).toBe("comparing-tools");
    expect(result.score).toBe(60);
    expect(result.suggestedAngle).toBe(
      "Highlight key differentiators vs competitors",
    );
  });
});

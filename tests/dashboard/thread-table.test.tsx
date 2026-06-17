/**
 * Unit tests: ThreadTable component
 *
 * Verifies:
 *   - Thread rows render title as a safe text node (not dangerouslySetInnerHTML)
 *   - intentLabel badge and intentScore are rendered
 *   - EmptyState is shown when the threads array is empty
 */

import * as React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

// Mock the server action so importing ThreadTable doesn't pull in node-only modules.
vi.mock("@/app/_actions/mark-false-positive", () => ({
  markFalsePositive: vi.fn().mockResolvedValue(undefined),
}));

// Delay import until after mocks are registered.
const { ThreadTable } = await import("@/app/_components/thread-table");
type ThreadRow = import("@/app/_components/thread-table").ThreadRow;

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BASE_THREAD: ThreadRow = {
  id: "t1",
  workspaceId: "ws1",
  redditPostId: "rp1",
  redditUrl: "https://www.reddit.com/r/SaaS/comments/abc123",
  title: "Best CRM for indie SaaS?",
  body: "Looking for lightweight options.",
  subreddit: "SaaS",
  intentLabel: "asking-for-recs",
  intentScore: 85,
  suggestedAngle: "Position as lightweight alternative",
  replyScaffold: "Hey, I built something for this…",
  falsePositive: false,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
};

/** Thread whose title contains raw HTML — proves text-node rendering. */
const XSS_THREAD: ThreadRow = {
  ...BASE_THREAD,
  id: "t2",
  title: "<b>alert html injection test</b>",
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("renders thread rows", () => {
  it("renders thread title as a text node, not innerHTML", () => {
    render(<ThreadTable threads={[XSS_THREAD]} />);

    // If title were injected via dangerouslySetInnerHTML the angle brackets
    // would become DOM elements and getByText(<b>...>) would fail.
    // A safe text node renders the literal string.
    const titleEl = screen.getByText("<b>alert html injection test</b>");
    expect(titleEl).toBeInTheDocument();

    // The rendered text equals the raw string — no parsed HTML entities.
    expect(titleEl.textContent).toBe("<b>alert html injection test</b>");
  });

  it("renders intentLabel badge and intentScore", () => {
    render(<ThreadTable threads={[BASE_THREAD]} />);

    // IntentBadge for "asking-for-recs" must show some recognisable text.
    expect(screen.getByText(/asking/i)).toBeInTheDocument();

    // intentScore 85 must be present.
    expect(screen.getByText("85")).toBeInTheDocument();
  });
});

describe("empty state", () => {
  it("renders EmptyState when no threads exist", () => {
    render(<ThreadTable threads={[]} />);

    // DataTable delegates to EmptyState; verify a friendly heading is shown.
    const heading = screen.getByRole("heading");
    expect(heading).toBeInTheDocument();
    // Must not render a table body with rows.
    expect(screen.queryByRole("row")).toBeNull();
  });
});

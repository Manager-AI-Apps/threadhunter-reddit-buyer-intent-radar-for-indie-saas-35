/**
 * Unit test: onboarding redirects after submit
 *
 * Verifies the onboarding form calls createWorkspace and, on success,
 * navigates the user to /dashboard.
 */

import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// ── Mock dependencies ─────────────────────────────────────────────────────────

const mockPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  redirect: vi.fn(),
}));

const mockCreateWorkspace = vi.fn();

vi.mock("@/app/_actions/create-workspace", () => ({
  createWorkspace: (...args: unknown[]) => mockCreateWorkspace(...args),
}));

// ── Test suite ────────────────────────────────────────────────────────────────

describe("onboarding redirects after submit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateWorkspace.mockResolvedValue(undefined);
  });

  it("form submission calls createWorkspace and redirects to /dashboard", async () => {
    const { default: OnboardingPage } = await import("@/app/onboarding/page");
    render(<OnboardingPage />);

    // Fill in required fields
    fireEvent.change(screen.getByLabelText(/product name/i), {
      target: { value: "ThreadHunter" },
    });
    fireEvent.change(screen.getByLabelText(/product url/i), {
      target: { value: "https://threadhunter.app" },
    });
    fireEvent.change(screen.getByLabelText(/ideal customer/i), {
      target: { value: "Indie SaaS founders doing Reddit outreach manually" },
    });
    fireEvent.change(screen.getByLabelText(/subreddits/i), {
      target: {
        value: "r/SaaS, r/IndieHackers, r/entrepreneur",
      },
    });

    // Submit the form
    fireEvent.submit(screen.getByRole("form") ?? screen.getByTestId("onboarding-form"));

    // createWorkspace should have been called
    await waitFor(() => {
      expect(mockCreateWorkspace).toHaveBeenCalledOnce();
    });

    // After success, expect redirect to /dashboard
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/dashboard");
    });
  });
});

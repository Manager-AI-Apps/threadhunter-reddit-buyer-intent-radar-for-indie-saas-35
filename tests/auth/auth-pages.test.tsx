import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// Mock auth client
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signUp: {
      email: vi.fn().mockResolvedValue({ error: null }),
    },
    signIn: {
      email: vi.fn().mockResolvedValue({ error: null }),
      social: vi.fn().mockResolvedValue({ error: null }),
    },
  },
}));

describe("sign-up renders fields", () => {
  it("renders Sign up, Email, Password fields and Google button", async () => {
    const { default: SignUpPage } = await import("@/app/sign-up/page");
    render(<SignUpPage />);

    // "Sign up" appears (button or heading)
    expect(screen.getByRole("button", { name: /sign up/i })).toBeInTheDocument();
    // Email label
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    // Password label
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    // Google button
    expect(screen.getByRole("button", { name: /google/i })).toBeInTheDocument();
  });
});

describe("sign-in renders fields", () => {
  it("renders Sign in, Email, Password fields and Google button", async () => {
    const { default: SignInPage } = await import("@/app/sign-in/page");
    render(<SignInPage />);

    // "Sign in" appears (button or heading)
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
    // Email label
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    // Password label
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    // Google button
    expect(screen.getByRole("button", { name: /google/i })).toBeInTheDocument();
  });
});

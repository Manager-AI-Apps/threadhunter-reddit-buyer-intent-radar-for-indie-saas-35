import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import Page from "@/app/page";

describe("landing renders product name", () => {
  it("renders ThreadHunter, buyer-intent, and a link to /sign-up", () => {
    render(<Page />);

    // "ThreadHunter" appears in the header and hero — at least one occurrence
    const threadHunterNodes = screen.getAllByText(/ThreadHunter/i);
    expect(threadHunterNodes.length).toBeGreaterThan(0);

    // "buyer-intent" appears in the badge/subtitle
    const intentNodes = screen.getAllByText(/buyer-intent/i);
    expect(intentNodes.length).toBeGreaterThan(0);

    // At least one link to /sign-up exists
    const signUpLinks = screen.getAllByRole("link", { name: /sign.?up|get started/i });
    const toSignUp = signUpLinks.find(
      (el) => el.getAttribute("href") === "/sign-up"
    );
    expect(toSignUp).toBeTruthy();
  });
});

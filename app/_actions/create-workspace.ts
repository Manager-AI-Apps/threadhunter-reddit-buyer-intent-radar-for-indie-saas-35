"use server";

/**
 * Server action: createWorkspace
 *
 * 1. Validates the caller's session — rejects unauthenticated requests.
 * 2. Validates and normalises form input (Zod).
 * 3. Inserts a new workspace row.
 * 4. Triggers OpenAI query-expansion to populate `expandedQueries`.
 * 5. Redirects to /dashboard.
 */

import { z } from "zod";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api-error";
import { insertWorkspace, expandWorkspaceQueries } from "@/lib/queries/workspace";

// ── Input schema ──────────────────────────────────────────────────────────────

const CreateWorkspaceSchema = z.object({
  name: z
    .string()
    .min(1, "Product name is required.")
    .max(100, "Product name must be 100 characters or fewer."),
  description: z
    .string()
    .min(1, "ICP description is required.")
    .max(1000, "ICP description must be 1 000 characters or fewer."),
  productUrl: z
    .string()
    .url("Enter a valid product URL (e.g. https://myapp.com)."),
  subreddits: z
    .array(z.string().min(1))
    .min(3, "Enter at least 3 subreddits.")
    .max(8, "Enter at most 8 subreddits."),
});

// ── Server action ─────────────────────────────────────────────────────────────

export async function createWorkspace(formData: FormData): Promise<void> {
  // ── Auth check ──────────────────────────────────────────────────────────────
  const sessionData = await auth.api.getSession({ headers: await headers() });
  if (!sessionData?.session || !sessionData?.user) {
    throw new ApiError(
      "unauthorized",
      "You must be signed in to create a workspace.",
    );
  }

  // ── Input validation ────────────────────────────────────────────────────────
  const subredditsRaw = String(formData.get("subreddits") ?? "");
  const subreddits = subredditsRaw
    .split(",")
    .map((s) => s.trim().replace(/^r\//, "").trim())
    .filter(Boolean);

  const parsed = CreateWorkspaceSchema.safeParse({
    name: String(formData.get("name") ?? "").trim(),
    description: String(formData.get("description") ?? "").trim(),
    productUrl: String(formData.get("productUrl") ?? "").trim(),
    subreddits,
  });

  if (!parsed.success) {
    const message =
      parsed.error.issues[0]?.message ?? "Invalid form input.";
    throw new ApiError("bad_request", message);
  }

  // ── Persist workspace ───────────────────────────────────────────────────────
  const workspace = await insertWorkspace(db, {
    userId: sessionData.user.id,
    name: parsed.data.name,
    description: parsed.data.description,
    productUrl: parsed.data.productUrl,
    subreddits: parsed.data.subreddits,
  });

  // ── Expand queries via OpenAI ───────────────────────────────────────────────
  // Non-fatal: if this fails the workspace still exists and can be re-expanded later.
  try {
    await expandWorkspaceQueries(workspace.id, db);
  } catch (err) {
    console.error("[createWorkspace] expandWorkspaceQueries failed:", err);
  }

  // ── Redirect ────────────────────────────────────────────────────────────────
  redirect("/dashboard");
}

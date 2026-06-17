"use server";

/**
 * Server actions for the workspace settings page.
 *
 * updateSubreddits — replace the subreddit watchlist for the current user's workspace
 * updateRules      — replace the allow/block keyword rules for the current user's workspace
 *
 * Both actions:
 *  1. Validate the caller's session (throws ApiError "unauthorized" if absent).
 *  2. Look up the workspace by workspaceId + userId (throws "forbidden" if not owned).
 *  3. Validate input with Zod.
 *  4. Persist the new values with explicit updatedAt.
 */

import { z } from "zod";
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api-error";
import {
  updateWorkspaceSubreddits,
  updateWorkspaceRules,
} from "@/lib/queries/workspace-settings";

// ── Shared result type ────────────────────────────────────────────────────────

export interface ActionResult {
  success: boolean;
  error?: string;
}

// ── Input schemas ─────────────────────────────────────────────────────────────

const UpdateSubredditsSchema = z.object({
  workspaceId: z.string().min(1, "workspaceId is required."),
  subreddits: z
    .array(z.string().min(1))
    .min(1, "Enter at least one subreddit.")
    .max(8, "Enter at most 8 subreddits."),
});

const UpdateRulesSchema = z.object({
  workspaceId: z.string().min(1, "workspaceId is required."),
  allowRules: z.array(z.string()).max(20, "At most 20 allow rules."),
  blockRules: z.array(z.string()).max(20, "At most 20 block rules."),
});

// ── Helper: normalise comma-separated string → trimmed, cleaned array ─────────

function parseCommaSeparated(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// ── updateSubreddits ──────────────────────────────────────────────────────────

/**
 * Replace the subreddit watchlist for the caller's workspace.
 *
 * FormData keys:
 *  - `workspaceId` (string)   — the workspace to update
 *  - `subreddits`  (string)   — comma-separated subreddit names, e.g. "SaaS,IndieHackers"
 */
export async function updateSubreddits(
  formData: FormData,
): Promise<ActionResult> {
  // ── Auth ─────────────────────────────────────────────────────────────────────
  const sessionData = await auth.api.getSession({ headers: await headers() });
  if (!sessionData?.session || !sessionData?.user) {
    throw new ApiError(
      "unauthorized",
      "You must be signed in to update settings.",
    );
  }

  // ── Input validation ─────────────────────────────────────────────────────────
  const workspaceId = String(formData.get("workspaceId") ?? "").trim();
  const subreddits = parseCommaSeparated(
    String(formData.get("subreddits") ?? ""),
  ).map((s) => s.replace(/^r\//, "").trim()); // strip leading "r/"

  const parsed = UpdateSubredditsSchema.safeParse({ workspaceId, subreddits });
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  // ── Persist ───────────────────────────────────────────────────────────────────
  try {
    await updateWorkspaceSubreddits(
      db,
      parsed.data.workspaceId,
      sessionData.user.id,
      parsed.data.subreddits,
    );
  } catch (err) {
    if (err instanceof ApiError) {
      return { success: false, error: err.message };
    }
    console.error("[updateSubreddits]", err);
    return { success: false, error: "Failed to update subreddits." };
  }

  return { success: true };
}

// ── updateRules ───────────────────────────────────────────────────────────────

/**
 * Replace the allow/block rules for the caller's workspace.
 *
 * FormData keys:
 *  - `workspaceId` (string) — the workspace to update
 *  - `allowRules`  (string) — comma-separated allow keywords (empty = no filter)
 *  - `blockRules`  (string) — comma-separated block keywords
 */
export async function updateRules(formData: FormData): Promise<ActionResult> {
  // ── Auth ─────────────────────────────────────────────────────────────────────
  const sessionData = await auth.api.getSession({ headers: await headers() });
  if (!sessionData?.session || !sessionData?.user) {
    throw new ApiError(
      "unauthorized",
      "You must be signed in to update settings.",
    );
  }

  // ── Input validation ─────────────────────────────────────────────────────────
  const workspaceId = String(formData.get("workspaceId") ?? "").trim();
  const allowRules = parseCommaSeparated(
    String(formData.get("allowRules") ?? ""),
  );
  const blockRules = parseCommaSeparated(
    String(formData.get("blockRules") ?? ""),
  );

  const parsed = UpdateRulesSchema.safeParse({
    workspaceId,
    allowRules,
    blockRules,
  });
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  // ── Persist ───────────────────────────────────────────────────────────────────
  try {
    await updateWorkspaceRules(
      db,
      parsed.data.workspaceId,
      sessionData.user.id,
      parsed.data.allowRules,
      parsed.data.blockRules,
    );
  } catch (err) {
    if (err instanceof ApiError) {
      return { success: false, error: err.message };
    }
    console.error("[updateRules]", err);
    return { success: false, error: "Failed to update rules." };
  }

  return { success: true };
}

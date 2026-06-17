/**
 * Workspace-settings data-access functions.
 *
 * All functions accept an explicit `db` argument (defaulting to the app's
 * shared instance) so tests can substitute an in-process pglite database.
 */

import { and, eq } from "drizzle-orm";

import { db as defaultDb, type Database } from "@/lib/db";
import { workspaces } from "@/lib/db/schema";
import { ApiError } from "@/lib/api-error";

// ── updateSubreddits ──────────────────────────────────────────────────────────

/**
 * Replace the subreddit watchlist for a workspace.
 *
 * Enforces ownership: throws `forbidden` if `userId` does not own `workspaceId`.
 * Sets `updatedAt` explicitly to the current timestamp.
 */
export async function updateWorkspaceSubreddits(
  db: Database,
  workspaceId: string,
  userId: string,
  subreddits: string[],
): Promise<void> {
  // Ownership check — fetch only what we need.
  const [workspace] = await db
    .select({ id: workspaces.id, userId: workspaces.userId })
    .from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), eq(workspaces.userId, userId)));

  if (!workspace) {
    throw new ApiError(
      "forbidden",
      "Workspace not found or you do not have access.",
    );
  }

  await db
    .update(workspaces)
    .set({ subreddits, updatedAt: new Date() })
    .where(eq(workspaces.id, workspaceId));
}

// ── updateRules ───────────────────────────────────────────────────────────────

/**
 * Replace the allow/block rules for a workspace.
 *
 * Enforces ownership: throws `forbidden` if `userId` does not own `workspaceId`.
 * Sets `updatedAt` explicitly to the current timestamp.
 */
export async function updateWorkspaceRules(
  db: Database,
  workspaceId: string,
  userId: string,
  allowRules: string[],
  blockRules: string[],
): Promise<void> {
  // Ownership check.
  const [workspace] = await db
    .select({ id: workspaces.id, userId: workspaces.userId })
    .from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), eq(workspaces.userId, userId)));

  if (!workspace) {
    throw new ApiError(
      "forbidden",
      "Workspace not found or you do not have access.",
    );
  }

  await db
    .update(workspaces)
    .set({ allowRules, blockRules, updatedAt: new Date() })
    .where(eq(workspaces.id, workspaceId));
}

// ── get workspace with fallback ────────────────────────────────────────────────

/**
 * Return the first workspace for a user, or `null` if none exists yet.
 */
export async function getWorkspaceForUser(
  userId: string,
  db: Database = defaultDb,
): Promise<typeof workspaces.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.userId, userId))
    .limit(1);

  return row ?? null;
}

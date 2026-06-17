/**
 * Expand a workspace's product description into 8-12 semantic Reddit search
 * queries using the OpenAI Chat Completions API.
 *
 * This module exposes `expandQueries` as a stable public API used by both the
 * POST /api/workspace/expand-queries route handler and the createWorkspace
 * server action. The result is persisted to workspace.expandedQueries with an
 * explicit updatedAt timestamp.
 *
 * Uses requireEnv("OPENAI_API_KEY") inside the function (not at module
 * top-level) so a missing key fails at call-time with a meaningful error
 * rather than at import/build time.
 */

import { db as defaultDb, type Database } from "@/lib/db";
import { expandWorkspaceQueries } from "@/lib/queries/workspace";

/**
 * Expand the product description stored in the given workspace into 8-12
 * semantic search queries and persist them in workspace.expandedQueries.
 *
 * @param workspaceId - ID of the workspace to expand queries for.
 * @param db - Drizzle database instance (defaults to the shared app db).
 */
export async function expandQueries(
  workspaceId: string,
  db: Database = defaultDb,
): Promise<void> {
  return expandWorkspaceQueries(workspaceId, db);
}

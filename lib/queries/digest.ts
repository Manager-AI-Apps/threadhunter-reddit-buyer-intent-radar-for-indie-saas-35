/**
 * Digest data-access: query undigested threads, create digest run records,
 * mark threads as sent.
 *
 * All functions accept an explicit `db` argument (defaulting to the shared app
 * instance) so integration tests can substitute a pglite database.
 */

import { and, desc, eq, inArray, isNull } from "drizzle-orm";

import { db as defaultDb, type Database } from "@/lib/db";
import {
  threads,
  digestRuns,
  digestRunThreads,
  type DigestRunStatus,
} from "@/lib/db/schema";

// ── Exported types ────────────────────────────────────────────────────────────

export type DigestThreadRow = typeof threads.$inferSelect;

// ── Queries ───────────────────────────────────────────────────────────────────

/**
 * Returns top N threads for a weekly digest:
 * - falsePositive = false
 * - digestSentAt IS NULL (not yet included in any digest)
 * - ordered by intentScore DESC
 * - max 10 results (spec: 5–10, capped at 10)
 */
export async function getThreadsForDigest(
  workspaceId: string,
  database: Database = defaultDb,
): Promise<DigestThreadRow[]> {
  return database
    .select()
    .from(threads)
    .where(
      and(
        eq(threads.workspaceId, workspaceId),
        eq(threads.falsePositive, false),
        isNull(threads.digestSentAt),
      ),
    )
    .orderBy(desc(threads.intentScore))
    .limit(10);
}

// ── Mutations ─────────────────────────────────────────────────────────────────

/**
 * Creates a digest_run row for the given workspace with `status = "completed"`
 * and `ranAt = now`. Returns the new run id.
 */
export async function createDigestRun(
  workspaceId: string,
  database: Database = defaultDb,
): Promise<string> {
  const now = new Date();
  const id = crypto.randomUUID();

  await database.insert(digestRuns).values({
    id,
    workspaceId,
    status: "completed" as DigestRunStatus,
    ranAt: now,
    createdAt: now,
    updatedAt: now,
  });

  return id;
}

/**
 * Creates digest_run_threads join rows linking the run to each thread,
 * assigning rank by array position (1-based).
 */
export async function createDigestRunThreads(
  digestRunId: string,
  threadIds: string[],
  database: Database = defaultDb,
): Promise<void> {
  if (threadIds.length === 0) return;

  const now = new Date();
  const rows = threadIds.map((threadId, index) => ({
    id: crypto.randomUUID(),
    digestRunId,
    threadId,
    rank: index + 1,
    createdAt: now,
  }));

  await database.insert(digestRunThreads).values(rows);
}

/**
 * Stamps `digestSentAt = now` on all thread rows in the given id list.
 */
export async function markThreadsDigestSent(
  threadIds: string[],
  database: Database = defaultDb,
): Promise<void> {
  if (threadIds.length === 0) return;

  const now = new Date();
  await database
    .update(threads)
    .set({ digestSentAt: now, updatedAt: now })
    .where(inArray(threads.id, threadIds));
}

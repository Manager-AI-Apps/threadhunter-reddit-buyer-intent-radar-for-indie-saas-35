/**
 * Thread data-access functions + ingest orchestration.
 *
 * All DB-accepting functions take an explicit `db` argument (defaulting to the
 * app's shared instance at call time) so integration tests can substitute an
 * in-process pglite database without patching module internals.
 */

import { and, eq, inArray } from "drizzle-orm";

import { db as defaultDb, type Database } from "@/lib/db";
import { threads, workspaces, type IntentLabel } from "@/lib/db/schema";
import { fetchSubredditNew, type RedditPost } from "@/lib/reddit-client";
import { classifyPost, type ClassificationResult } from "@/lib/intent-classifier";

// ── Public types ──────────────────────────────────────────────────────────────

export interface InsertThreadData {
  workspaceId: string;
  redditPostId: string;
  redditUrl: string;
  title: string;
  body: string;
  subreddit: string;
  intentLabel: IntentLabel;
  intentScore: number;
  suggestedAngle?: string | null;
  replyScaffold?: string | null;
}

export type FetchPostsFn = (
  subreddit: string,
  limit: number,
) => Promise<RedditPost[]>;

export type ClassifyPostFn = (
  post: RedditPost,
  expandedQueries: string[],
) => Promise<ClassificationResult>;

export interface IngestResult {
  inserted: number;
  skipped: number;
}

// ── Queries ───────────────────────────────────────────────────────────────────

/**
 * Returns the set of redditPostIds that already exist in the `threads` table
 * for a given workspace. Used to avoid unnecessary classify+insert for posts
 * we've already seen. The unique constraint provides the final race guard.
 */
export async function getExistingPostIds(
  db: Database,
  workspaceId: string,
  postIds: string[],
): Promise<Set<string>> {
  if (postIds.length === 0) return new Set<string>();

  const rows = await db
    .select({ redditPostId: threads.redditPostId })
    .from(threads)
    .where(
      and(
        eq(threads.workspaceId, workspaceId),
        inArray(threads.redditPostId, postIds),
      ),
    );

  return new Set(rows.map((r) => r.redditPostId));
}

/**
 * Inserts a thread row using `onConflictDoNothing()` so concurrent callers do
 * not raise an error — the unique index `threads_workspace_post_idx` on
 * `(workspaceId, redditPostId)` is the serialisation point.
 *
 * @returns `true` if the row was inserted, `false` if it was skipped (duplicate).
 */
export async function insertThread(
  db: Database,
  data: InsertThreadData,
): Promise<boolean> {
  const now = new Date();

  const result = await db
    .insert(threads)
    .values({
      id: crypto.randomUUID(),
      workspaceId: data.workspaceId,
      redditPostId: data.redditPostId,
      redditUrl: data.redditUrl,
      title: data.title,
      body: data.body,
      subreddit: data.subreddit,
      intentLabel: data.intentLabel,
      intentScore: data.intentScore,
      suggestedAngle: data.suggestedAngle ?? null,
      replyScaffold: data.replyScaffold ?? null,
      falsePositive: false,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: threads.id });

  return result.length > 0;
}

// ── Ingest orchestration ──────────────────────────────────────────────────────

/**
 * Core ingest logic — processes exactly ONE workspace to stay within Render's
 * 30-second HTTP timeout.
 *
 * For each subreddit in the workspace:
 *   1. Fetch the newest posts from the licensed Reddit Data API.
 *   2. Skip posts already present in the `threads` table (pre-check + unique
 *      constraint for concurrent races).
 *   3. Call the intent classifier for each new post, passing the workspace's
 *      `expandedQueries` as context.
 *   4. Insert the classified thread row.
 *
 * @param options.db           Database instance (defaults to the app `db`).
 * @param options.workspaceId  If present, processes that specific workspace.
 *                             If absent, processes the first workspace found.
 * @param options.fetchPosts   Override Reddit fetch (for testing).
 * @param options.classifyFn   Override intent classifier (for testing).
 */
export async function runIngest(options: {
  db?: Database;
  workspaceId?: string;
  fetchPosts?: FetchPostsFn;
  classifyFn?: ClassifyPostFn;
}): Promise<IngestResult> {
  const {
    db: database = defaultDb,
    workspaceId,
    fetchPosts = fetchSubredditNew,
    classifyFn = classifyPost,
  } = options;

  // ── Resolve the target workspace ─────────────────────────────────────────
  const query = database.select().from(workspaces);
  const workspaceRows = workspaceId
    ? await query.where(eq(workspaces.id, workspaceId)).limit(1)
    : await query.limit(1);

  const workspace = workspaceRows[0];
  if (!workspace) {
    return { inserted: 0, skipped: 0 };
  }

  let inserted = 0;
  let skipped = 0;

  // ── Process each subreddit sequentially ──────────────────────────────────
  for (const subreddit of workspace.subreddits) {
    let posts: RedditPost[];
    try {
      posts = await fetchPosts(subreddit, 25);
    } catch (err) {
      // Log and continue so one bad subreddit doesn't abort the whole workspace.
      console.error(
        `[ingest] Failed to fetch r/${subreddit} for workspace ${workspace.id}:`,
        err,
      );
      continue;
    }

    if (posts.length === 0) continue;

    // Pre-check: which posts do we already have? Reduces unnecessary classify calls.
    const postIds = posts.map((p) => p.id);
    const existingIds = await getExistingPostIds(database, workspace.id, postIds);

    for (const post of posts) {
      if (existingIds.has(post.id)) {
        skipped++;
        continue;
      }

      let classification: ClassificationResult;
      try {
        classification = await classifyFn(post, workspace.expandedQueries);
      } catch (err) {
        // Log and skip — one classifier failure shouldn't block other posts.
        console.error(
          `[ingest] Classifier failed for post ${post.id} in r/${subreddit}:`,
          err,
        );
        skipped++;
        continue;
      }

      // Insert — onConflictDoNothing handles concurrent race at the DB level.
      const wasInserted = await insertThread(database, {
        workspaceId: workspace.id,
        redditPostId: post.id,
        redditUrl: post.url,
        title: post.title,
        body: post.selftext,
        subreddit,
        intentLabel: classification.label,
        intentScore: classification.score,
        suggestedAngle: classification.suggestedAngle,
        replyScaffold: classification.replyScaffold,
      });

      if (wasInserted) {
        inserted++;
      } else {
        skipped++;
      }
    }
  }

  return { inserted, skipped };
}

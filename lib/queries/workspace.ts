/**
 * Workspace data-access functions.
 *
 * All functions accept an explicit `db` argument (defaulting to the app's
 * shared instance) so tests can substitute an in-process pglite database
 * without patching module internals.
 */

import { eq } from "drizzle-orm";

import { db as defaultDb, type Database } from "@/lib/db";
import { workspaces } from "@/lib/db/schema";
import { requireEnv } from "@/lib/env";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CreateWorkspaceInput {
  userId: string;
  name: string;
  /** ICP: Ideal Customer Profile — plain-language description of who buys this product. */
  description: string;
  productUrl: string;
  subreddits: string[];
}

export type WorkspaceRow = typeof workspaces.$inferSelect;

// ── Query: insert ─────────────────────────────────────────────────────────────

/**
 * Insert a new workspace row and return it.
 * Sets both createdAt and updatedAt explicitly (rule: never rely on defaults
 * for updatedAt; every insert/update must set it explicitly).
 */
export async function insertWorkspace(
  db: Database,
  input: CreateWorkspaceInput,
): Promise<WorkspaceRow> {
  const id = crypto.randomUUID();
  const now = new Date();

  const [row] = await db
    .insert(workspaces)
    .values({
      id,
      userId: input.userId,
      name: input.name,
      description: input.description,
      productUrl: input.productUrl,
      subreddits: input.subreddits,
      expandedQueries: [],
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (!row) {
    throw new Error("Failed to insert workspace: no row returned.");
  }

  return row;
}

// ── Query: expand queries via OpenAI ─────────────────────────────────────────

/**
 * Call the OpenAI Chat Completions API to generate semantic Reddit search
 * queries from this workspace's product name, ICP, and subreddit list.
 * Stores the resulting string array in `expandedQueries` and sets `updatedAt`.
 */
export async function expandWorkspaceQueries(
  workspaceId: string,
  db: Database = defaultDb,
): Promise<void> {
  const apiKey = requireEnv("OPENAI_API_KEY");

  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));

  if (!workspace) {
    throw new Error(`Workspace "${workspaceId}" not found.`);
  }

  const systemPrompt =
    "You are a Reddit research assistant for indie SaaS founders. " +
    "Given a product name, its Ideal Customer Profile (ICP), and the subreddits the founder watches, " +
    "generate 8–12 semantic search queries to find threads where people are: " +
    "(1) asking for a tool recommendation, " +
    "(2) complaining about an incumbent solution, or " +
    "(3) comparing tools in this category. " +
    'Return ONLY valid JSON in the exact shape: {"queries": ["query1", "query2", ...]}';

  const userPrompt =
    `Product: ${workspace.name}\n` +
    `ICP: ${workspace.description}\n` +
    `Subreddits: ${workspace.subreddits.map((s) => `r/${s}`).join(", ")}\n\n` +
    "Generate semantic search queries covering the three intent signals.";

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `OpenAI API error: ${response.status} ${response.statusText}`,
    );
  }

  const responseData = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  const rawContent = responseData.choices[0]?.message?.content ?? "{}";

  let queries: string[] = [];
  try {
    const parsed = JSON.parse(rawContent) as { queries?: unknown };
    if (Array.isArray(parsed.queries)) {
      queries = parsed.queries.filter(
        (q): q is string => typeof q === "string" && q.length > 0,
      );
    }
  } catch {
    // OpenAI returned malformed JSON — proceed with empty list.
    queries = [];
  }

  await db
    .update(workspaces)
    .set({ expandedQueries: queries, updatedAt: new Date() })
    .where(eq(workspaces.id, workspaceId));
}

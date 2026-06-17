/**
 * POST /api/workspace/expand-queries
 *
 * Auth-gated endpoint that expands a workspace's product description into
 * 8-12 semantic Reddit search queries via OpenAI and persists them to
 * workspace.expandedQueries with an explicit updatedAt.
 *
 * Auth:      Better Auth session (cookie / Authorization header)
 * Ownership: caller must own the workspace
 * Rate-limit: 5 requests per user per minute
 *
 * Request body: { workspaceId: string }
 * Response:     { ok: true }
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { workspaces } from "@/lib/db/schema";
import { ApiError, handleRoute } from "@/lib/api-error";
import { rateLimit } from "@/lib/rate-limit";
import { expandQueries } from "@/lib/queries/expand-queries";

const BodySchema = z.object({
  workspaceId: z.string().min(1, "workspaceId is required"),
});

export const POST = handleRoute(async (req: NextRequest) => {
  // ── 1. Validate session ────────────────────────────────────────────────────
  const sessionData = await auth.api.getSession({ headers: req.headers });
  if (!sessionData?.session || !sessionData?.user) {
    throw new ApiError("unauthorized", "You must be signed in.");
  }

  const userId = sessionData.user.id;

  // ── 2. Rate limit (5 req/min per user) ────────────────────────────────────
  const rl = rateLimit(`expand-queries:${userId}`, 5, 60_000);
  if (!rl.ok) {
    throw new ApiError(
      "rate_limited",
      "Too many requests. Try again in a minute.",
    );
  }

  // ── 3. Parse + validate request body ──────────────────────────────────────
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    throw new ApiError("bad_request", "Request body must be valid JSON.");
  }

  const parsed = BodySchema.safeParse(rawBody);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid request body.";
    throw new ApiError("bad_request", message);
  }

  const { workspaceId } = parsed.data;

  // ── 4. Verify workspace ownership ─────────────────────────────────────────
  const [workspace] = await db
    .select({ id: workspaces.id, userId: workspaces.userId })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));

  if (!workspace) {
    throw new ApiError("not_found", "Workspace not found.");
  }

  if (workspace.userId !== userId) {
    throw new ApiError("forbidden", "You do not own this workspace.");
  }

  // ── 5. Expand queries via OpenAI ───────────────────────────────────────────
  await expandQueries(workspaceId, db);

  return NextResponse.json({ ok: true });
});

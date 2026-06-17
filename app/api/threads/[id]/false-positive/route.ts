/**
 * PATCH /api/threads/[id]/false-positive
 *
 * Marks a thread as a false positive. The caller must own the workspace the
 * thread belongs to — any mismatch is rejected with 403 (IDOR prevention).
 *
 * Returns: { ok: true, threadId: string }
 *
 * Error codes:
 *   400 bad_request   — threadId param missing or malformed
 *   401 unauthorized  — no valid session
 *   403 forbidden     — thread belongs to a workspace the caller does not own
 *   404 not_found     — threadId does not exist
 */

import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { threads, workspaces } from "@/lib/db/schema";
import { ApiError, handleRoute } from "@/lib/api-error";

// ── Route params type ─────────────────────────────────────────────────────────

interface RouteContext {
  params: Promise<{ id: string }>;
}

// ── Route handler ─────────────────────────────────────────────────────────────

export const PATCH = handleRoute(
  async (_req: NextRequest, context: RouteContext): Promise<Response> => {
    // ── Resolve params ──────────────────────────────────────────────────────
    const { id: threadId } = await context.params;

    if (!threadId || typeof threadId !== "string") {
      throw new ApiError("bad_request", "Thread ID is required.");
    }

    // ── Auth check ──────────────────────────────────────────────────────────
    const sessionData = await auth.api.getSession({
      headers: await headers(),
    });

    if (!sessionData?.session || !sessionData?.user) {
      throw new ApiError("unauthorized", "You must be signed in.");
    }

    const userId = sessionData.user.id;

    // ── IDOR check: thread must belong to a workspace owned by the caller ───
    const [thread] = await db
      .select({ id: threads.id, workspaceId: threads.workspaceId })
      .from(threads)
      .where(eq(threads.id, threadId))
      .limit(1);

    if (!thread) {
      throw new ApiError("not_found", "Thread not found.");
    }

    const [workspace] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(
        and(
          eq(workspaces.id, thread.workspaceId),
          eq(workspaces.userId, userId),
        ),
      )
      .limit(1);

    if (!workspace) {
      throw new ApiError(
        "forbidden",
        "You do not have permission to update this thread.",
      );
    }

    // ── Update ──────────────────────────────────────────────────────────────
    await db
      .update(threads)
      .set({ falsePositive: true, updatedAt: new Date() })
      .where(eq(threads.id, threadId));

    return NextResponse.json({ ok: true, threadId });
  },
);

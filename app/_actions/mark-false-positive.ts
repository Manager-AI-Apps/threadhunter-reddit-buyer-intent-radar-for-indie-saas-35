"use server";

/**
 * Server action: markFalsePositive
 *
 * Marks a thread as a false positive. Validates that the calling user owns
 * the workspace the thread belongs to before updating, then revalidates the
 * dashboard cache path so the row disappears on the next render.
 */

import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { threads, workspaces } from "@/lib/db/schema";
import { ApiError } from "@/lib/api-error";

export interface MarkFalsePositiveResult {
  ok: true;
}

export async function markFalsePositive(
  threadId: string,
): Promise<MarkFalsePositiveResult> {
  if (!threadId || typeof threadId !== "string") {
    throw new ApiError("bad_request", "threadId is required.");
  }

  // ── Auth check ──────────────────────────────────────────────────────────────
  const sessionData = await auth.api.getSession({ headers: await headers() });
  if (!sessionData?.session || !sessionData?.user) {
    throw new ApiError("unauthorized", "You must be signed in.");
  }

  const userId = sessionData.user.id;

  // ── Authorisation: verify the thread belongs to a workspace owned by the user ──
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
      and(eq(workspaces.id, thread.workspaceId), eq(workspaces.userId, userId)),
    )
    .limit(1);

  if (!workspace) {
    throw new ApiError(
      "forbidden",
      "You do not have permission to update this thread.",
    );
  }

  // ── Update ──────────────────────────────────────────────────────────────────
  await db
    .update(threads)
    .set({ falsePositive: true, updatedAt: new Date() })
    .where(eq(threads.id, threadId));

  revalidatePath("/dashboard");

  return { ok: true };
}

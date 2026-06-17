/**
 * POST /api/ingest
 *
 * Cron-triggered endpoint that fetches new Reddit posts for a workspace,
 * classifies their buyer intent, and persists them to the `threads` table.
 *
 * Auth: INGEST_SECRET header (timing-safe comparison).
 *
 * Query params:
 *   workspaceId (optional) — if present, processes only that workspace.
 *                             If absent, processes the first workspace found.
 *
 * Returns: { inserted: number, skipped: number }
 *
 * One workspace per call to stay within Render's 30-second HTTP timeout.
 */

import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { ApiError, handleRoute } from "@/lib/api-error";
import { requireEnv } from "@/lib/env";
import { db } from "@/lib/db";
import { runIngest } from "@/lib/queries/threads";

// ── Auth helpers ──────────────────────────────────────────────────────────────

/**
 * Constant-time string comparison that prevents timing-based secret discovery.
 * If lengths differ we still run a dummy timingSafeEqual to avoid leaking
 * length information via call-time differences.
 */
function secureCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);

  if (bufA.length !== bufB.length) {
    // Dummy comparison of bufA against itself to keep constant time behaviour.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
}

// ── Route handler ─────────────────────────────────────────────────────────────

/** GET is not supported; return 401 so health-checks get a sub-402 status. */
export const GET = handleRoute(async (_req: NextRequest) => {
  throw new ApiError("unauthorized", "Use POST with a valid x-ingest-secret header.");
});

export const POST = handleRoute(async (req: NextRequest) => {
  // 1. Validate INGEST_SECRET (read inside handler, not at module top-level)
  const expected = requireEnv("INGEST_SECRET");
  const provided = req.headers.get("x-ingest-secret") ?? "";

  if (!secureCompare(provided, expected)) {
    throw new ApiError("unauthorized", "Invalid ingest secret.");
  }

  // 2. Resolve optional workspaceId query param
  const { searchParams } = new URL(req.url);
  const workspaceId = searchParams.get("workspaceId") ?? undefined;

  // 3. Run ingest for one workspace
  const result = await runIngest({ db, workspaceId });

  return NextResponse.json(result);
});

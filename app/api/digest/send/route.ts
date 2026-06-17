/**
 * POST /api/digest/send
 *
 * Cron-triggered endpoint that:
 *   1. Validates the INGEST_SECRET header (timing-safe).
 *   2. Queries the top ≤10 undigested threads for the given workspace.
 *   3. Renders and sends a digest email via the Resend API (retries on 5xx).
 *   4. Creates a digest_run row and digest_run_threads joins.
 *   5. Stamps digestSentAt on each included thread.
 *
 * Body: { workspaceId: string, recipientEmail: string }
 *       recipientEmail is optional when workspace has a configured email.
 *
 * Auth: x-ingest-secret header (same secret as /api/ingest).
 */

import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { Resend } from "resend";
import { z } from "zod";

import { ApiError, handleRoute } from "@/lib/api-error";
import { requireEnv } from "@/lib/env";
import { db as defaultDb, type Database } from "@/lib/db";
import { workspaces, user } from "@/lib/db/schema";
import {
  getThreadsForDigest,
  createDigestRun,
  createDigestRunThreads,
  markThreadsDigestSent,
  type DigestThreadRow,
} from "@/lib/queries/digest";
import {
  renderDigestEmail,
  type DigestThread,
} from "@/lib/email/digest-template";

// ── Schema ────────────────────────────────────────────────────────────────────

const bodySchema = z.object({
  workspaceId: z.string().min(1),
  recipientEmail: z.string().email().optional(),
});

// ── Auth helper ───────────────────────────────────────────────────────────────

/**
 * Constant-time string comparison to prevent timing-based secret discovery.
 * When lengths differ, a dummy comparison is performed to keep call
 * duration constant.
 */
function secureCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);

  if (bufA.length !== bufB.length) {
    // Compare bufA against itself (same-length) to avoid leaking length
    // via total call time.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
}

// ── Resend helper (with retry) ────────────────────────────────────────────────

interface SendEmailArgs {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  html: string;
}

/** Sends an email via Resend, retrying up to 3 times on 5xx responses. */
async function sendEmailWithRetry(args: SendEmailArgs): Promise<void> {
  const resend = new Resend(args.apiKey);
  const MAX_RETRIES = 3;

  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const { data, error } = await resend.emails.send({
      from: args.from,
      to: args.to,
      subject: args.subject,
      html: args.html,
    });

    if (error != null) {
      // Resend surfaces rate-limit and server errors as error objects.
      // We retry on anything that looks like a transient server-side failure.
      const status = (error as { statusCode?: number }).statusCode ?? 0;
      if (status >= 500 && attempt < MAX_RETRIES) {
        lastError = error;
        // Exponential back-off: 200ms, 400ms
        await new Promise((r) => setTimeout(r, 200 * attempt));
        continue;
      }
      throw new ApiError(
        "internal",
        `Resend error: ${error.message ?? "unknown"}`,
      );
    }

    if (data == null) {
      throw new ApiError("internal", "Resend returned no data.");
    }

    return; // success
  }

  throw new ApiError("internal", `Email send failed after retries: ${String(lastError)}`);
}

// ── Core digest logic (exported for integration tests) ───────────────────────

interface SendDigestOptions {
  workspaceId: string;
  recipientEmail?: string;
  db?: Database;
  /** Override email sending for tests — receives the final HTML. */
  sendEmail?: (html: string) => Promise<void>;
}

export interface SendDigestResult {
  digestRunId: string;
  threadCount: number;
}

/**
 * Core digest logic, separated from HTTP concerns so integration tests
 * can call it directly with a test database and a no-op sendEmail override.
 */
export async function sendDigest(
  options: SendDigestOptions,
): Promise<SendDigestResult> {
  const { workspaceId, recipientEmail, db = defaultDb } = options;

  // ── Lookup workspace + owner email ──────────────────────────────────────────
  const [workspaceRow] = await db
    .select({ id: workspaces.id, name: workspaces.name, userId: workspaces.userId })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);

  if (workspaceRow == null) {
    throw new ApiError("not_found", `Workspace ${workspaceId} not found.`);
  }

  // Resolve recipient: explicit param → workspace owner's email
  let toEmail = recipientEmail;
  if (toEmail == null) {
    const [ownerRow] = await db
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, workspaceRow.userId))
      .limit(1);

    if (ownerRow == null) {
      throw new ApiError("not_found", "Workspace owner not found.");
    }
    toEmail = ownerRow.email;
  }

  // ── Query undigested threads ─────────────────────────────────────────────────
  const undigested: DigestThreadRow[] = await getThreadsForDigest(workspaceId, db);

  // ── Create digest run (even if no threads — records the attempt) ────────────
  const digestRunId = await createDigestRun(workspaceId, db);
  const threadIds = undigested.map((t) => t.id);

  if (undigested.length > 0) {
    // ── Render email ─────────────────────────────────────────────────────────
    const digestThreads: DigestThread[] = undigested.map((t) => ({
      id: t.id,
      title: t.title,
      intentLabel: t.intentLabel,
      intentScore: t.intentScore,
      suggestedAngle: t.suggestedAngle ?? null,
      replyScaffold: t.replyScaffold ?? null,
      redditUrl: t.redditUrl,
    }));

    const html = renderDigestEmail(digestThreads, workspaceRow.name);

    // ── Send email ────────────────────────────────────────────────────────────
    if (options.sendEmail != null) {
      await options.sendEmail(html);
    } else {
      const apiKey = requireEnv("RESEND_API_KEY");
      const from = requireEnv("DIGEST_FROM_EMAIL");
      const subject = `ThreadHunter: ${undigested.length} buyer-intent thread${undigested.length !== 1 ? "s" : ""} this week — ${workspaceRow.name}`;

      await sendEmailWithRetry({ apiKey, from, to: toEmail, subject, html });
    }

    // ── Persist join rows + stamp threads ─────────────────────────────────────
    await Promise.all([
      createDigestRunThreads(digestRunId, threadIds, db),
      markThreadsDigestSent(threadIds, db),
    ]);
  }

  return { digestRunId, threadCount: undigested.length };
}

// ── Route handler ─────────────────────────────────────────────────────────────

/** GET is not supported; return 401 so health-checks get a sub-402 status. */
export const GET = handleRoute(async (_req: NextRequest) => {
  throw new ApiError("unauthorized", "Use POST with a valid x-ingest-secret header.");
});

export const POST = handleRoute(async (req: NextRequest) => {
  // 1. Validate INGEST_SECRET
  const expected = requireEnv("INGEST_SECRET");
  const provided = req.headers.get("x-ingest-secret") ?? "";

  if (!secureCompare(provided, expected)) {
    throw new ApiError("unauthorized", "Invalid ingest secret.");
  }

  // 2. Parse + validate body
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    throw new ApiError("bad_request", "Request body must be valid JSON.");
  }

  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    throw new ApiError(
      "bad_request",
      `Invalid request: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    );
  }

  const { workspaceId, recipientEmail } = parsed.data;

  // 3. Run digest
  const result = await sendDigest({ workspaceId, recipientEmail });

  return NextResponse.json(result);
});

/**
 * OpenAI-backed intent classifier for Reddit posts.
 *
 * Classifies a post as one of four buyer-intent labels with a 0–100 score,
 * a suggested reply angle, and a disclosure-safe reply scaffold.
 *
 * Retries automatically on 5xx errors (max 2 retries = 3 total attempts).
 */

import { requireEnv } from "@/lib/env";
import type { RedditPost } from "@/lib/reddit-client";
import type { IntentLabel } from "@/lib/db/schema";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ClassificationResult {
  /** One of the four buyer-intent labels. */
  label: IntentLabel;
  /** Buyer-intent confidence score from 0 (none) to 100 (very high). */
  score: number;
  /** 1–2 sentence suggested angle for a reply to this thread. */
  suggestedAngle: string;
  /** Disclosure-safe reply scaffold the founder can adapt. */
  replyScaffold: string;
}

// ---------------------------------------------------------------------------
// Private types (OpenAI response shape)
// ---------------------------------------------------------------------------

interface OpenAIChatResponse {
  choices: Array<{
    message: {
      content: string | null;
    };
  }>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const MAX_RETRIES = 2; // 2 retries = 3 total attempts

const SYSTEM_PROMPT = `You are an intent classifier for Reddit threads. Given a Reddit post title and body, classify its buyer intent for a SaaS product.

Classify the post into exactly ONE of these labels:
- "asking-for-recs": The author is actively asking for tool or product recommendations
- "complaining-about-incumbent": The author is venting about a current tool they use and may switch
- "comparing-tools": The author is explicitly comparing multiple tools or asking for a comparison
- "unrelated": The post does not signal any of the above buying intent

Return ONLY valid JSON matching this exact schema — no markdown fences, no extra text:
{
  "label": "<one of the four labels above>",
  "score": <integer 0-100 representing buyer intent strength>,
  "suggestedAngle": "<1-2 sentence suggested reply angle for a founder>",
  "replyScaffold": "<disclosure-safe reply scaffold the founder can adapt>"
}`;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classifies a Reddit post's buyer intent via OpenAI chat completions.
 *
 * @param post            The Reddit post to classify.
 * @param expandedQueries Semantic query expansions generated from the product
 *                        description — passed to the model as helpful context.
 * @returns               A typed {@link ClassificationResult}.
 * @throws                An error if the API fails after all retries, or if the
 *                        response cannot be parsed into the expected shape.
 */
export async function classifyPost(
  post: RedditPost,
  expandedQueries: string[],
): Promise<ClassificationResult> {
  const apiKey = requireEnv("OPENAI_API_KEY");
  const userMessage = buildUserMessage(post, expandedQueries);

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let response: Response;

    try {
      response = await fetch(OPENAI_CHAT_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userMessage },
          ],
          temperature: 0.1,
          max_tokens: 512,
        }),
      });
    } catch (err) {
      // Network-level failure — propagate immediately (no point retrying)
      throw err instanceof Error
        ? err
        : new Error("Network error calling OpenAI chat completions");
    }

    // 5xx server error — retry
    if (response.status >= 500 && response.status < 600) {
      lastError = new Error(
        `OpenAI returned HTTP ${response.status} ${response.statusText} ` +
          `(attempt ${attempt + 1} of ${MAX_RETRIES + 1})`,
      );
      continue;
    }

    // Non-5xx client error — fail immediately without retrying
    if (!response.ok) {
      let errorMessage: string = response.statusText;
      try {
        const body = (await response.json()) as Record<string, unknown>;
        const apiErr = body?.error as Record<string, unknown> | undefined;
        if (typeof apiErr?.message === "string") {
          errorMessage = apiErr.message;
        }
      } catch {
        // ignore JSON parse failure — use statusText
      }
      throw new Error(
        `OpenAI API error ${response.status}: ${errorMessage}`,
      );
    }

    // Successful response — parse and return
    const data = (await response.json()) as OpenAIChatResponse;
    const content = data?.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("OpenAI returned an empty message content");
    }

    return parseClassificationResult(content);
  }

  // All attempts exhausted — throw the last recorded 5xx error
  throw (
    lastError ??
    new Error(
      `OpenAI chat completions request failed after ${MAX_RETRIES + 1} attempts`,
    )
  );
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function buildUserMessage(
  post: RedditPost,
  expandedQueries: string[],
): string {
  const querySection =
    expandedQueries.length > 0
      ? `\nProduct semantic queries (context for classification):\n` +
        expandedQueries.map((q) => `- ${q}`).join("\n")
      : "";

  return (
    `Title: ${post.title}\n` +
    `Body: ${post.selftext || "(no body)"}\n` +
    `URL: ${post.url}` +
    querySection +
    `\n\nClassify this post.`
  );
}

const VALID_LABELS = new Set<IntentLabel>([
  "asking-for-recs",
  "complaining-about-incumbent",
  "comparing-tools",
  "unrelated",
]);

function isIntentLabel(value: unknown): value is IntentLabel {
  return typeof value === "string" && VALID_LABELS.has(value as IntentLabel);
}

function parseClassificationResult(content: string): ClassificationResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(
      `OpenAI returned non-JSON content: ${content.slice(0, 200)}`,
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("OpenAI returned unexpected non-object JSON");
  }

  const obj = parsed as Record<string, unknown>;

  if (!isIntentLabel(obj.label)) {
    throw new Error(
      `OpenAI returned invalid intent label: ${JSON.stringify(obj.label)}. ` +
        `Expected one of: asking-for-recs, complaining-about-incumbent, comparing-tools, unrelated.`,
    );
  }

  const rawScore = Number(obj.score);
  if (!Number.isFinite(rawScore) || rawScore < 0 || rawScore > 100) {
    throw new Error(
      `OpenAI returned out-of-range score: ${JSON.stringify(obj.score)}. Expected 0–100.`,
    );
  }

  return {
    label: obj.label,
    score: Math.round(rawScore),
    suggestedAngle: typeof obj.suggestedAngle === "string" ? obj.suggestedAngle : "",
    replyScaffold: typeof obj.replyScaffold === "string" ? obj.replyScaffold : "",
  };
}

/**
 * Reddit OAuth2 client for licensed Data API access.
 *
 * Uses client-credentials flow (app-only OAuth) to fetch a bearer token
 * that is cached at module scope until 60 seconds before it expires.
 * All subreddit reads go through the rate-limited oauth.reddit.com base URL.
 */

import { requireEnv } from "@/lib/env";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RedditPost {
  id: string;
  title: string;
  selftext: string;
  author: string;
  url: string;
  created_utc: number;
}

interface TokenData {
  accessToken: string;
  /** Unix ms at which the cached token becomes invalid */
  expiresAt: number;
}

interface RedditTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

interface RedditChild {
  kind: string;
  data: {
    id: string;
    title: string;
    selftext: string;
    author: string;
    url: string;
    created_utc: number;
    [key: string]: unknown;
  };
}

interface RedditListing {
  kind: "Listing";
  data: {
    children: RedditChild[];
    [key: string]: unknown;
  };
}

// ---------------------------------------------------------------------------
// Token cache (module singleton)
// ---------------------------------------------------------------------------

let _cache: TokenData | null = null;

const REDDIT_TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
const REDDIT_OAUTH_BASE = "https://oauth.reddit.com";
const BUFFER_MS = 60_000; // 60 s buffer before expiry

/**
 * Resets the cached token. Exported for unit-test isolation only.
 * Do NOT call this in production code.
 */
export function resetTokenCache(): void {
  _cache = null;
}

// ---------------------------------------------------------------------------
// Token fetch
// ---------------------------------------------------------------------------

/**
 * Returns a valid OAuth2 bearer token, fetching a new one only when the
 * cached one is absent or within 60 seconds of expiry.
 */
export async function getToken(): Promise<string> {
  const now = Date.now();

  if (_cache !== null && now < _cache.expiresAt) {
    return _cache.accessToken;
  }

  const clientId = requireEnv("REDDIT_CLIENT_ID");
  const clientSecret = requireEnv("REDDIT_CLIENT_SECRET");
  const userAgent = requireEnv("REDDIT_USER_AGENT");

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64",
  );

  const response = await fetch(REDDIT_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": userAgent,
    },
    body: "grant_type=client_credentials",
  });

  if (!response.ok) {
    throw new Error(
      `Reddit OAuth token request failed: HTTP ${response.status} ${response.statusText}`,
    );
  }

  const data = (await response.json()) as RedditTokenResponse;

  if (!data.access_token || typeof data.expires_in !== "number") {
    throw new Error(
      "Reddit OAuth response missing required fields (access_token / expires_in)",
    );
  }

  _cache = {
    accessToken: data.access_token,
    expiresAt: now + (data.expires_in * 1_000 - BUFFER_MS),
  };

  return _cache.accessToken;
}

// ---------------------------------------------------------------------------
// Subreddit listing
// ---------------------------------------------------------------------------

/**
 * Fetches the newest posts from a subreddit using the licensed Reddit Data API.
 *
 * @param subreddit  Raw subreddit name (no "r/" prefix)
 * @param limit      Number of posts to fetch (1–100; Reddit clamps at 100)
 * @returns          Typed array of RedditPost objects
 */
export async function fetchSubredditNew(
  subreddit: string,
  limit: number,
): Promise<RedditPost[]> {
  if (!subreddit || typeof subreddit !== "string" || subreddit.trim() === "") {
    throw new Error("fetchSubredditNew: subreddit name must be a non-empty string");
  }

  const clampedLimit = Math.min(Math.max(Math.floor(limit), 1), 100);
  const userAgent = requireEnv("REDDIT_USER_AGENT");
  const token = await getToken();

  const url = `${REDDIT_OAUTH_BASE}/r/${encodeURIComponent(subreddit.trim())}/new.json?limit=${clampedLimit}&raw_json=1`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": userAgent,
    },
  });

  if (!response.ok) {
    throw new Error(
      `Reddit listing request failed for r/${subreddit}: HTTP ${response.status} ${response.statusText}`,
    );
  }

  const listing = (await response.json()) as RedditListing;

  if (
    !listing?.data?.children ||
    !Array.isArray(listing.data.children)
  ) {
    throw new Error(
      `Unexpected Reddit listing response shape for r/${subreddit}`,
    );
  }

  return listing.data.children.map((child): RedditPost => {
    const d = child.data;
    return {
      id: String(d.id),
      title: String(d.title),
      selftext: String(d.selftext ?? ""),
      author: String(d.author),
      url: String(d.url),
      created_utc: Number(d.created_utc),
    };
  });
}

/**
 * Weekly digest email template.
 *
 * Renders a plain-HTML email string using template literals with explicit
 * HTML escaping. Deliberately avoids react-dom/server (renderToStaticMarkup),
 * which is forbidden in Next.js App Router route handlers.
 *
 * Usage:
 *   const html = renderDigestEmail(threads, workspaceName);
 *   // pass html + a plain text fallback to Resend
 */

// ── Exported types ────────────────────────────────────────────────────────────

export interface DigestThread {
  id: string;
  title: string;
  intentLabel: string;
  intentScore: number;
  suggestedAngle: string | null;
  replyScaffold: string | null;
  redditUrl: string;
}

// ── HTML helpers ──────────────────────────────────────────────────────────────

/** Escapes a string for safe embedding in HTML text or attribute values. */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

// ── Template builders ─────────────────────────────────────────────────────────

function threadCardHtml(thread: DigestThread, rank: number): string {
  const angleSection =
    thread.suggestedAngle != null && thread.suggestedAngle !== ""
      ? `<p style="color:#374151;margin:0 0 8px 0"><strong>Angle:</strong> ${esc(thread.suggestedAngle)}</p>`
      : "";

  const scaffoldSection =
    thread.replyScaffold != null && thread.replyScaffold !== ""
      ? `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:12px;margin-top:8px">` +
        `<p style="font-size:12px;text-transform:uppercase;letter-spacing:0.06em;color:#6b7280;margin:0 0 6px 0">Reply scaffold</p>` +
        `<p style="color:#1f2937;margin:0;white-space:pre-wrap">${esc(thread.replyScaffold)}</p>` +
        `</div>`
      : "";

  return (
    `<div style="border-left:4px solid #6366f1;padding-left:16px;margin-bottom:32px">` +
    `<p style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;margin:0 0 4px 0">` +
    `#${rank} &middot; ${esc(thread.intentLabel)} &middot; Score: ${thread.intentScore}/100` +
    `</p>` +
    `<h2 style="font-size:18px;font-weight:600;color:#111827;margin:0 0 8px 0">` +
    `<a href="${esc(thread.redditUrl)}" style="color:#4f46e5;text-decoration:none">${esc(thread.title)}</a>` +
    `</h2>` +
    angleSection +
    scaffoldSection +
    `</div>`
  );
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Renders the digest email to a static HTML string.
 *
 * @param digestThreads  Thread rows to include (5–10 recommended).
 * @param workspaceName  Displayed in the subject line and footer.
 * @returns              HTML string safe for email delivery.
 */
export function renderDigestEmail(
  digestThreads: DigestThread[],
  workspaceName: string,
): string {
  const titleEsc = esc(workspaceName);

  const bodyContent =
    digestThreads.length === 0
      ? `<p style="color:#6b7280;text-align:center">No new high-intent threads this week. Stay tuned!</p>`
      : `<p style="color:#374151;margin-top:0;margin-bottom:24px">` +
        `Here are your top ${digestThreads.length} high-intent Reddit ` +
        `thread${digestThreads.length !== 1 ? "s" : ""} this week. ` +
        `Each is ranked by buyer intent &mdash; reply while they&rsquo;re fresh.` +
        `</p>` +
        digestThreads.map((t, i) => threadCardHtml(t, i + 1)).join("");

  return (
    `<!DOCTYPE html>` +
    `<html lang="en">` +
    `<head>` +
    `<meta charset="utf-8" />` +
    `<meta name="viewport" content="width=device-width, initial-scale=1" />` +
    `<title>ThreadHunter Weekly Digest &mdash; ${titleEsc}</title>` +
    `</head>` +
    `<body style="font-family:'Helvetica Neue',Arial,sans-serif;background:#f9fafb;margin:0;padding:0">` +
    `<div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden">` +
    `<div style="background:#4f46e5;padding:28px 32px">` +
    `<h1 style="color:#ffffff;font-size:22px;font-weight:700;margin:0 0 4px 0">ThreadHunter</h1>` +
    `<p style="color:#c7d2fe;margin:0;font-size:14px">Weekly digest for ${titleEsc}</p>` +
    `</div>` +
    `<div style="padding:32px">${bodyContent}</div>` +
    `<div style="border-top:1px solid #e5e7eb;padding:20px 32px;background:#f9fafb">` +
    `<p style="color:#9ca3af;font-size:12px;margin:0;text-align:center">` +
    `You&rsquo;re receiving this because you set up ThreadHunter for ${titleEsc}. Threads are delivered weekly.` +
    `</p>` +
    `</div>` +
    `</div>` +
    `</body>` +
    `</html>`
  );
}

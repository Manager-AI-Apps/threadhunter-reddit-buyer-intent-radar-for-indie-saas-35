/**
 * Weekly digest email template.
 *
 * Renders a plain-HTML email string using React's renderToStaticMarkup —
 * no dangerouslySetInnerHTML, all content escaped via React's default JSX
 * text escaping.
 *
 * Usage:
 *   const html = renderDigestEmail(threads, workspaceName);
 *   // pass html + a plain text fallback to Resend
 */

import { renderToStaticMarkup } from "react-dom/server";

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

// ── Template components ───────────────────────────────────────────────────────

function ThreadCard({ thread, rank }: { thread: DigestThread; rank: number }) {
  return (
    <div
      style={{
        borderLeft: "4px solid #6366f1",
        paddingLeft: "16px",
        marginBottom: "32px",
      }}
    >
      <p
        style={{
          fontSize: "11px",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "#6b7280",
          margin: "0 0 4px 0",
        }}
      >
        #{rank} · {thread.intentLabel} · Score: {thread.intentScore}/100
      </p>
      <h2
        style={{
          fontSize: "18px",
          fontWeight: "600",
          color: "#111827",
          margin: "0 0 8px 0",
        }}
      >
        <a
          href={thread.redditUrl}
          style={{ color: "#4f46e5", textDecoration: "none" }}
        >
          {thread.title}
        </a>
      </h2>
      {thread.suggestedAngle != null && thread.suggestedAngle !== "" && (
        <p style={{ color: "#374151", margin: "0 0 8px 0" }}>
          <strong>Angle:</strong> {thread.suggestedAngle}
        </p>
      )}
      {thread.replyScaffold != null && thread.replyScaffold !== "" && (
        <div
          style={{
            background: "#f8fafc",
            border: "1px solid #e2e8f0",
            borderRadius: "6px",
            padding: "12px",
            marginTop: "8px",
          }}
        >
          <p
            style={{
              fontSize: "12px",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: "#6b7280",
              margin: "0 0 6px 0",
            }}
          >
            Reply scaffold
          </p>
          <p style={{ color: "#1f2937", margin: 0, whiteSpace: "pre-wrap" }}>
            {thread.replyScaffold}
          </p>
        </div>
      )}
    </div>
  );
}

function DigestEmailTemplate({
  digestThreads,
  workspaceName,
}: {
  digestThreads: DigestThread[];
  workspaceName: string;
}) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{`ThreadHunter Weekly Digest — ${workspaceName}`}</title>
      </head>
      <body
        style={{
          fontFamily: "'Helvetica Neue', Arial, sans-serif",
          background: "#f9fafb",
          margin: 0,
          padding: "0",
        }}
      >
        <div
          style={{
            maxWidth: "600px",
            margin: "0 auto",
            background: "#ffffff",
            borderRadius: "8px",
            overflow: "hidden",
          }}
        >
          {/* Header */}
          <div
            style={{
              background: "#4f46e5",
              padding: "28px 32px",
            }}
          >
            <h1
              style={{
                color: "#ffffff",
                fontSize: "22px",
                fontWeight: "700",
                margin: "0 0 4px 0",
              }}
            >
              ThreadHunter
            </h1>
            <p style={{ color: "#c7d2fe", margin: 0, fontSize: "14px" }}>
              Weekly digest for {workspaceName}
            </p>
          </div>

          {/* Body */}
          <div style={{ padding: "32px" }}>
            {digestThreads.length === 0 ? (
              <p style={{ color: "#6b7280", textAlign: "center" }}>
                No new high-intent threads this week. Stay tuned!
              </p>
            ) : (
              <>
                <p
                  style={{
                    color: "#374151",
                    marginTop: 0,
                    marginBottom: "24px",
                  }}
                >
                  Here are your top {digestThreads.length} high-intent Reddit
                  thread{digestThreads.length !== 1 ? "s" : ""} this week.
                  Each is ranked by buyer intent — reply while they&apos;re
                  fresh.
                </p>
                {digestThreads.map((thread, index) => (
                  <ThreadCard key={thread.id} thread={thread} rank={index + 1} />
                ))}
              </>
            )}
          </div>

          {/* Footer */}
          <div
            style={{
              borderTop: "1px solid #e5e7eb",
              padding: "20px 32px",
              background: "#f9fafb",
            }}
          >
            <p
              style={{
                color: "#9ca3af",
                fontSize: "12px",
                margin: 0,
                textAlign: "center",
              }}
            >
              You&apos;re receiving this because you set up ThreadHunter for{" "}
              {workspaceName}. Threads are delivered weekly.
            </p>
          </div>
        </div>
      </body>
    </html>
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
  return renderToStaticMarkup(
    <DigestEmailTemplate
      digestThreads={digestThreads}
      workspaceName={workspaceName}
    />,
  );
}

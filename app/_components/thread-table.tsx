"use client";

/**
 * ThreadTable — renders the inbox of buyer-intent threads for a workspace.
 *
 * Columns: subreddit, title (safe text node), intent badge, score,
 *          suggested angle, reply scaffold, link to Reddit, false-positive action.
 *
 * Uses the shared DataTable block which shows EmptyState automatically when
 * the rows array is empty.
 */

import * as React from "react";
import { ExternalLink } from "lucide-react";

import { DataTable, type Column } from "@/components/blocks/data-table";
import { EmptyState } from "@/components/blocks/empty-state";
import { Button } from "@/components/ui/button";
import { IntentBadge } from "@/app/_components/intent-badge";
import { markFalsePositive } from "@/app/_actions/mark-false-positive";
import type { threads } from "@/lib/db/schema";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ThreadRow = typeof threads.$inferSelect;

// ── False-positive button ──────────────────────────────────────────────────────

function FalsePositiveButton({ threadId }: { threadId: string }) {
  const [isPending, startTransition] = React.useTransition();

  function handleClick() {
    startTransition(async () => {
      await markFalsePositive(threadId);
    });
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={isPending}
      onClick={handleClick}
      aria-label="Mark as false positive"
    >
      False positive
    </Button>
  );
}

// ── Column definitions ─────────────────────────────────────────────────────────

const COLUMNS: Column<ThreadRow>[] = [
  {
    key: "subreddit",
    header: "Subreddit",
    cell: (row) => (
      <span className="font-mono text-sm text-muted-foreground">
        r/{row.subreddit}
      </span>
    ),
  },
  {
    key: "title",
    header: "Title",
    cell: (row) => (
      /* Render as a plain text node — never dangerouslySetInnerHTML. */
      <span className="line-clamp-2 max-w-xs text-sm font-medium">
        {row.title}
      </span>
    ),
    className: "max-w-xs",
  },
  {
    key: "intentLabel",
    header: "Intent",
    cell: (row) => <IntentBadge label={row.intentLabel} />,
  },
  {
    key: "intentScore",
    header: "Score",
    cell: (row) => <span>{row.intentScore}</span>,
    numeric: true,
  },
  {
    key: "suggestedAngle",
    header: "Suggested angle",
    cell: (row) => (
      <span className="line-clamp-2 max-w-xs text-sm text-muted-foreground">
        {row.suggestedAngle ?? "—"}
      </span>
    ),
    className: "max-w-xs",
  },
  {
    key: "replyScaffold",
    header: "Reply scaffold",
    cell: (row) => (
      <span className="line-clamp-2 max-w-xs text-sm text-muted-foreground">
        {row.replyScaffold ?? "—"}
      </span>
    ),
    className: "max-w-xs",
  },
  {
    key: "link",
    header: "Link",
    cell: (row) => (
      <a
        href={row.redditUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open Reddit thread: ${row.title}`}
        className="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
      >
        <ExternalLink className="size-3.5 shrink-0" />
        Reddit
      </a>
    ),
  },
  {
    key: "falsePositive",
    header: "",
    cell: (row) => <FalsePositiveButton threadId={row.id} />,
  },
];

// ── Component ─────────────────────────────────────────────────────────────────

export function ThreadTable({ threads }: { threads: ThreadRow[] }) {
  return (
    <DataTable
      columns={COLUMNS}
      rows={threads}
      getRowKey={(row) => row.id}
      empty={
        <EmptyState
          title="No threads found yet"
          description="ThreadHunter will surface high-intent Reddit threads here once the first ingest runs. Check back after the next digest."
        />
      }
    />
  );
}

/**
 * Dashboard — Thread Inbox
 *
 * Server component. Fetches the signed-in user's workspace and its
 * buyer-intent threads (sorted by intentScore DESC, false positives excluded),
 * then renders the AppShell with the ThreadTable.
 */

import * as React from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { Inbox, Settings } from "lucide-react";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { workspaces } from "@/lib/db/schema";
import { getThreadsForWorkspace } from "@/lib/queries/threads";
import { AppShell, type NavItem } from "@/components/app-shell";
import { PageHeader } from "@/components/blocks/page-header";
import { ThreadTable } from "@/app/_components/thread-table";

// ── Nav ───────────────────────────────────────────────────────────────────────

const NAV: NavItem[] = [
  {
    title: "Thread Inbox",
    href: "/dashboard",
    icon: <Inbox className="size-4" />,
  },
  {
    title: "Settings",
    href: "/settings",
    icon: <Settings className="size-4" />,
  },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  // ── Auth check ──────────────────────────────────────────────────────────────
  const sessionData = await auth.api.getSession({ headers: await headers() });
  if (!sessionData?.session || !sessionData?.user) {
    redirect("/sign-in");
  }

  const userId = sessionData.user.id;

  // ── Workspace + threads (parallel where possible) ──────────────────────────
  const [workspaceRow] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.userId, userId))
    .limit(1);

  // No workspace → send user through onboarding.
  if (!workspaceRow) {
    redirect("/onboarding");
  }

  const threads = await getThreadsForWorkspace(workspaceRow.id, db);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <AppShell
      appName="ThreadHunter"
      nav={NAV}
      header={
        <PageHeader
          title="Thread Inbox"
          description={`Buyer-intent threads for ${workspaceRow.name} — sorted by intent score`}
        />
      }
    >
      <div className="space-y-6">
        <ThreadTable threads={threads} />
      </div>
    </AppShell>
  );
}

/**
 * Settings — Subreddit Watchlist Manager
 *
 * Server component. Loads the signed-in user's workspace and renders:
 *  - A form to edit the subreddit watchlist (3–8 subs)
 *  - A form to edit allow/block keyword rules
 *
 * Updates are submitted through the updateSubreddits and updateRules server
 * actions which validate session ownership and set updatedAt explicitly.
 */

import * as React from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Inbox, Settings } from "lucide-react";

import { auth } from "@/lib/auth";
import { getWorkspaceForUser } from "@/lib/queries/workspace-settings";
import { AppShell, type NavItem } from "@/components/app-shell";
import { PageHeader } from "@/components/blocks/page-header";
import { SettingsForms } from "@/app/settings/_components/settings-forms";

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

export default async function SettingsPage() {
  // ── Auth check ──────────────────────────────────────────────────────────────
  const sessionData = await auth.api.getSession({ headers: await headers() });
  if (!sessionData?.session || !sessionData?.user) {
    redirect("/sign-in");
  }

  const userId = sessionData.user.id;

  // ── Load workspace ──────────────────────────────────────────────────────────
  const workspace = await getWorkspaceForUser(userId);

  if (!workspace) {
    redirect("/onboarding");
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <AppShell
      appName="ThreadHunter"
      nav={NAV}
      header={
        <PageHeader
          title="Settings"
          description={`Configure watchlist and rules for ${workspace.name}`}
        />
      }
    >
      <div className="mx-auto max-w-3xl space-y-8 py-2">
        <SettingsForms
          workspaceId={workspace.id}
          subreddits={workspace.subreddits}
          allowRules={workspace.allowRules}
          blockRules={workspace.blockRules}
        />
      </div>
    </AppShell>
  );
}

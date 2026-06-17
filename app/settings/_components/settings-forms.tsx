"use client";

/**
 * SettingsForms — client component that renders the subreddit watchlist editor
 * and the allow/block rules editor.
 *
 * Forms submit via the updateSubreddits and updateRules server actions and
 * show inline success/error feedback without a full page navigation.
 */

import * as React from "react";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { updateSubreddits, updateRules } from "@/app/_actions/update-workspace-settings";

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  workspaceId: string;
  subreddits: string[];
  allowRules: string[];
  blockRules: string[];
}

// ── Subreddit watchlist form ──────────────────────────────────────────────────

function SubredditForm({
  workspaceId,
  initialSubreddits,
}: {
  workspaceId: string;
  initialSubreddits: string[];
}) {
  const [value, setValue] = React.useState(() =>
    initialSubreddits.join(", "),
  );
  const [feedback, setFeedback] = React.useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setFeedback(null);

    startTransition(async () => {
      const result = await updateSubreddits(formData);
      if (result.success) {
        setFeedback({ type: "success", message: "Subreddits saved." });
      } else {
        setFeedback({
          type: "error",
          message: result.error ?? "Failed to save subreddits.",
        });
      }
    });
  }

  return (
    <Card className="rounded-xl border bg-card shadow-sm">
      <CardHeader className="pb-4">
        <CardTitle className="font-display text-xl font-medium">
          Subreddit Watchlist
        </CardTitle>
        <CardDescription className="text-sm text-muted-foreground">
          Comma-separated list of subreddits to monitor. Include 3–8 subs for
          best results (e.g.{" "}
          <span className="font-mono text-foreground">
            SaaS, IndieHackers, entrepreneur
          </span>
          ).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input type="hidden" name="workspaceId" value={workspaceId} />

          <div className="space-y-2">
            <Label htmlFor="subreddits">Subreddits</Label>
            <Input
              id="subreddits"
              name="subreddits"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="SaaS, IndieHackers, entrepreneur"
              disabled={isPending}
            />
            <p className="text-sm text-muted-foreground">
              No need to include the{" "}
              <span className="font-mono">r/</span> prefix.
            </p>
          </div>

          {feedback ? (
            <div
              className={
                feedback.type === "success"
                  ? "rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-primary"
                  : "rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
              }
            >
              {feedback.message}
            </div>
          ) : null}

          <Button type="submit" disabled={isPending}>
            {isPending ? "Saving…" : "Save watchlist"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ── Allow / block rules form ──────────────────────────────────────────────────

function RulesForm({
  workspaceId,
  initialAllowRules,
  initialBlockRules,
}: {
  workspaceId: string;
  initialAllowRules: string[];
  initialBlockRules: string[];
}) {
  const [allowValue, setAllowValue] = React.useState(() =>
    initialAllowRules.join(", "),
  );
  const [blockValue, setBlockValue] = React.useState(() =>
    initialBlockRules.join(", "),
  );
  const [feedback, setFeedback] = React.useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setFeedback(null);

    startTransition(async () => {
      const result = await updateRules(formData);
      if (result.success) {
        setFeedback({ type: "success", message: "Rules saved." });
      } else {
        setFeedback({
          type: "error",
          message: result.error ?? "Failed to save rules.",
        });
      }
    });
  }

  return (
    <Card className="rounded-xl border bg-card shadow-sm">
      <CardHeader className="pb-4">
        <CardTitle className="font-display text-xl font-medium">
          Allow / Block Rules
        </CardTitle>
        <CardDescription className="text-sm text-muted-foreground">
          Fine-tune which threads reach your inbox. Allow rules include only
          matching threads; block rules exclude threads containing those
          keywords.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5">
          <input type="hidden" name="workspaceId" value={workspaceId} />

          <div className="space-y-2">
            <Label htmlFor="allowRules">Allow keywords</Label>
            <Textarea
              id="allowRules"
              name="allowRules"
              value={allowValue}
              onChange={(e) => setAllowValue(e.target.value)}
              placeholder="recommendation, which tool, best app (leave blank = no filter)"
              rows={3}
              disabled={isPending}
            />
            <p className="text-sm text-muted-foreground">
              Comma-separated. Only threads containing one of these phrases
              will be scored. Leave empty to allow all.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="blockRules">Block keywords</Label>
            <Textarea
              id="blockRules"
              name="blockRules"
              value={blockValue}
              onChange={(e) => setBlockValue(e.target.value)}
              placeholder="hiring, job posting, off-topic"
              rows={3}
              disabled={isPending}
            />
            <p className="text-sm text-muted-foreground">
              Comma-separated. Threads containing any of these phrases are
              excluded from scoring.
            </p>
          </div>

          {feedback ? (
            <div
              className={
                feedback.type === "success"
                  ? "rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-primary"
                  : "rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
              }
            >
              {feedback.message}
            </div>
          ) : null}

          <Button type="submit" disabled={isPending}>
            {isPending ? "Saving…" : "Save rules"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ── Composed export ────────────────────────────────────────────────────────────

export function SettingsForms({
  workspaceId,
  subreddits,
  allowRules,
  blockRules,
}: Props) {
  return (
    <div className="space-y-6">
      <SubredditForm
        workspaceId={workspaceId}
        initialSubreddits={subreddits}
      />
      <RulesForm
        workspaceId={workspaceId}
        initialAllowRules={allowRules}
        initialBlockRules={blockRules}
      />
    </div>
  );
}

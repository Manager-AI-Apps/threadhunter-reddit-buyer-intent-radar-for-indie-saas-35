import * as React from "react";
import { Badge } from "@/components/ui/badge";
import type { IntentLabel } from "@/lib/db/schema";

// ── Label display mapping ─────────────────────────────────────────────────────

const LABEL_MAP: Record<
  IntentLabel,
  { display: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  "asking-for-recs": { display: "Asking for recs", variant: "default" },
  "complaining-about-incumbent": { display: "Complaining", variant: "destructive" },
  "comparing-tools": { display: "Comparing tools", variant: "secondary" },
  unrelated: { display: "Unrelated", variant: "outline" },
};

// ── Component ─────────────────────────────────────────────────────────────────

export function IntentBadge({ label }: { label: IntentLabel }) {
  const { display, variant } = LABEL_MAP[label] ?? {
    display: label,
    variant: "outline" as const,
  };

  return <Badge variant={variant}>{display}</Badge>;
}

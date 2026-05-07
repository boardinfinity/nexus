// BucketMappingCard — explains what bucket the JD was mapped to, why,
// and surfaces the candidate / auto-created flags admins keep asking about.
//
// Includes a "Why this bucket?" Collapsible disclosure that lists the top-3
// candidate buckets with their resolver scores. When the API doesn't return
// candidate scores yet (Track A's instrumentation isn't merged), we show a
// placeholder explaining that the breakdown is coming.
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, Layers, AlertTriangle } from "lucide-react";
import { InfoTooltip } from "./InfoTooltip";
import { cn } from "@/lib/utils";
import type { AnalyzeResult, BucketCandidate } from "./types";

interface BucketMappingCardProps {
  result: AnalyzeResult;
}

const actionLabels: Record<string, string> = {
  auto_assign: "auto-assigned",
  tentative: "tentative",
  show_candidates: "review candidates",
  needs_candidate: "candidate suggested",
  unclassified: "unclassified",
};

const actionTooltips: Record<string, string> = {
  auto_assign:
    "Resolver score crossed the auto-assign threshold and the bucket has validated status. The mapping was applied automatically.",
  tentative:
    "Resolver found a likely bucket but the score is in the soft band. Treat the mapping as provisional and confirm before bulk actions.",
  show_candidates:
    "Multiple buckets scored similarly. The UI is asking a human to pick the best one before the mapping locks in.",
  needs_candidate:
    "No existing bucket matched well. A new candidate bucket has been auto-created from the JD's classification fields and is waiting on admin validation.",
  unclassified:
    "Classification was too weak to resolve a bucket. The JD will sit in the unclassified pool until it's re-analysed or manually mapped.",
};

function StatusBadge({ status }: { status: BucketCandidate["status"] }) {
  const map: Record<BucketCandidate["status"], { label: string; cls: string; tip: string }> = {
    candidate: {
      label: "candidate",
      cls: "text-amber-700 border-amber-300 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-800",
      tip: "Candidate buckets are unvalidated — they were auto-created by the resolver and are awaiting admin review before they can drive sourcing or campaigns.",
    },
    validated: {
      label: "validated",
      cls: "text-green-700 border-green-300 bg-green-50 dark:bg-green-900/30 dark:text-green-200 dark:border-green-800",
      tip: "Validated buckets have been reviewed and locked in by an admin.",
    },
    deprecated: {
      label: "deprecated",
      cls: "text-muted-foreground border-muted-foreground/30",
      tip: "Deprecated buckets are kept for historical mapping but should not be used for new JDs.",
    },
    merged: {
      label: "merged",
      cls: "text-blue-700 border-blue-300",
      tip: "This bucket was merged into another — its mapping resolves to the survivor.",
    },
  };
  const m = map[status];
  return (
    <span className="inline-flex items-center gap-1">
      <Badge variant="outline" className={cn("text-[10px]", m.cls)}>
        {m.label}
      </Badge>
      <InfoTooltip label={`What does ${m.label} mean?`}>
        <p className="font-semibold mb-1 capitalize">{m.label} bucket</p>
        <p>{m.tip}</p>
      </InfoTooltip>
    </span>
  );
}

export function BucketMappingCard({ result }: BucketMappingCardProps) {
  const mapping = result.bucket_mapping;
  if (!mapping) {
    // Bucket label exists (LLM emitted one) but no resolver mapping ran.
    if (!result.bucket) return null;
    return (
      <Card data-testid="bucket-mapping-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Layers className="h-4 w-4" /> Bucket mapping
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            Resolver did not produce a structured mapping for this run. Showing the LLM's free-text bucket label only.
          </p>
        </CardContent>
      </Card>
    );
  }

  const confidencePct = Math.round((mapping.confidence || 0) * 100);
  const action = mapping.action;
  const isAutoCreated = action === "needs_candidate";
  const showCandidateBadge = mapping.candidate_needed || mapping.selected?.status === "candidate";

  // Track A may extend the response payload with richer reasoner scores.
  // For now we render whatever top_candidates contain; if the array is empty
  // we show a placeholder for the "Why this bucket?" panel.
  // TODO(track-A): once analyze_jd_runs instrumentation lands, hydrate the
  // expandable panel with per-signal contributions (signal, weight, contribution)
  // pulled from BucketCandidate.reasons.
  const candidates = mapping.top_candidates || [];

  return (
    <Card data-testid="bucket-mapping-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Layers className="h-4 w-4" /> Bucket mapping
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Header row: action + confidence + flags */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1">
            <Badge variant="outline" className="text-[10px]">
              {actionLabels[action] || action.replace(/_/g, " ")}
            </Badge>
            <InfoTooltip label="What does this resolver action mean?">
              <p className="font-semibold mb-1">Resolver action: {actionLabels[action] || action}</p>
              <p>{actionTooltips[action] || "Resolver outcome for this JD."}</p>
            </InfoTooltip>
          </div>

          <Badge variant="outline" className="text-[10px]">
            {confidencePct}% match
          </Badge>

          {showCandidateBadge && (
            <span className="inline-flex items-center gap-1">
              <Badge
                variant="outline"
                className="text-[10px] text-amber-700 border-amber-300 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-800"
              >
                candidate suggested
              </Badge>
              <InfoTooltip label="What does candidate suggested mean?">
                <p className="font-semibold mb-1">Candidate suggested</p>
                <p>
                  This bucket is <strong>unvalidated</strong> — it was auto-created (or proposed) by
                  the resolver and is waiting on admin review before it's promoted to{" "}
                  <span className="font-mono">validated</span>.
                </p>
                <p className="mt-1.5 text-muted-foreground">
                  Until then, mappings using this bucket are tentative and won't drive sourcing automation.
                </p>
              </InfoTooltip>
            </span>
          )}

          {isAutoCreated && (
            <span className="inline-flex items-center gap-1">
              <Badge
                variant="outline"
                className="text-[10px] text-purple-700 border-purple-300 bg-purple-50 dark:bg-purple-900/30 dark:text-purple-200 dark:border-purple-800"
              >
                auto-created candidate
              </Badge>
              <InfoTooltip label="What does auto-created candidate mean?">
                <p className="font-semibold mb-1">Auto-created candidate bucket</p>
                <p>
                  No existing bucket matched the JD's function / family / industry / seniority signals,
                  so the resolver created a new <span className="font-mono">candidate</span> bucket from
                  those fields. It needs admin sign-off before it counts as part of the governed taxonomy.
                </p>
              </InfoTooltip>
            </span>
          )}
        </div>

        {/* Selected bucket */}
        {mapping.selected ? (
          <div className="text-sm flex items-center gap-2 flex-wrap">
            <span className="font-medium">{mapping.selected.name}</span>
            <span className="text-muted-foreground text-xs font-mono">{mapping.selected.bucket_code}</span>
            <StatusBadge status={mapping.selected.status} />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground italic">{mapping.reason_summary}</p>
        )}

        {/* Why this bucket? — expandable disclosure */}
        <Collapsible>
          <CollapsibleTrigger className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
            <ChevronDown className="h-3.5 w-3.5 transition-transform data-[state=open]:rotate-180" />
            <span>Why this bucket?</span>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2">
            <div className="rounded-md border bg-muted/20 p-3 space-y-2">
              {mapping.reason_summary && (
                <p className="text-xs text-muted-foreground italic">{mapping.reason_summary}</p>
              )}

              {candidates.length > 0 ? (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Top {Math.min(3, candidates.length)} candidate{candidates.length === 1 ? "" : "s"}
                  </p>
                  <ul className="space-y-1.5">
                    {candidates.slice(0, 3).map((c, idx) => (
                      <li
                        key={c.bucket_id}
                        className="flex items-start justify-between gap-2 text-xs border-l-2 border-muted pl-2"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-mono text-[10px] text-muted-foreground">
                              #{idx + 1}
                            </span>
                            <span className="font-medium truncate">{c.name}</span>
                            <span className="text-muted-foreground text-[10px] font-mono">
                              {c.bucket_code}
                            </span>
                            <StatusBadge status={c.status} />
                          </div>
                          {c.reasons && c.reasons.length > 0 && (
                            <ul className="mt-1 ml-1 space-y-0.5">
                              {c.reasons.slice(0, 4).map((r, ri) => (
                                <li key={ri} className="text-[10px] text-muted-foreground">
                                  <span className="font-mono">{r.signal}</span>
                                  <span className="mx-1">·</span>
                                  <span>weight {r.weight}</span>
                                  <span className="mx-1">·</span>
                                  <span>+{(r.contribution * 100).toFixed(0)}%</span>
                                  {r.detail && <span className="ml-1 italic">— {r.detail}</span>}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                        <span className="font-mono text-[10px] shrink-0 tabular-nums">
                          {Math.round((c.score || 0) * 100)}%
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                // TODO(track-A): hydrate this with real top-3 candidates + per-signal contributions
                // once analyze_jd_runs instrumentation extends the /analyze-jd response payload.
                <div className="text-[11px] text-muted-foreground italic">
                  Resolver score breakdown coming with Track A's instrumentation. The current{" "}
                  <span className="font-mono">/api/analyze-jd</span> response does not yet include
                  per-candidate scores for every JD; once Track A's <span className="font-mono">analyze_jd_runs</span>{" "}
                  logging is live, this panel will show the top 3 candidate buckets with their signal-by-signal
                  contributions (function match, family match, seniority overlap, etc.).
                </div>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Mismatch flags surfaced clearly */}
        {mapping.mismatch_flags.length > 0 && (
          <div className="flex items-start gap-1.5 text-[11px] text-red-700 dark:text-red-400">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>{mapping.mismatch_flags.join(", ")}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

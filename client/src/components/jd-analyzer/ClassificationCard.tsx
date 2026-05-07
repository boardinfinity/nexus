// Classification card — function / family / industry / seniority / sub-role / geography
// with inline tooltip explainers for each field, especially `sub_role`.
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkles } from "lucide-react";
import { InfoTooltip } from "./InfoTooltip";
import type { AnalyzeResult } from "./types";

interface ClassificationCardProps {
  result: AnalyzeResult;
}

interface FieldRowProps {
  label: string;
  value: string | null | undefined;
  tooltip: React.ReactNode;
  variant?: "secondary" | "outline";
}

function FieldRow({ label, value, tooltip, variant = "secondary" }: FieldRowProps) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</span>
      <InfoTooltip label={`What is ${label}?`}>{tooltip}</InfoTooltip>
      <Badge variant={variant} className="text-xs font-normal">
        {value}
      </Badge>
    </div>
  );
}

export function ClassificationCard({ result }: ClassificationCardProps) {
  return (
    <Card data-testid="classification-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Sparkles className="h-4 w-4" /> Classification
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Bucket label banner */}
        {result.bucket && (
          <div className="rounded-lg bg-teal-600 text-white px-4 py-3">
            <p className="text-lg font-semibold">{result.bucket}</p>
            {result.standardized_title && result.standardized_title !== result.bucket && (
              <p className="text-teal-100 text-sm mt-0.5">{result.standardized_title}</p>
            )}
          </div>
        )}

        {/* Field rows with per-field tooltips */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <FieldRow
            label="Function"
            value={result.job_function_name}
            tooltip={
              <>
                <p className="font-semibold mb-1">Job function</p>
                <p>The broadest organisational grouping (e.g. Engineering, Sales, Finance). Used for cross-industry comparison.</p>
              </>
            }
          />
          <FieldRow
            label="Family"
            value={result.job_family_name}
            tooltip={
              <>
                <p className="font-semibold mb-1">Job family</p>
                <p>A function-level cluster of related roles (e.g. Software Engineering within Engineering). Maps to career ladders.</p>
              </>
            }
          />
          <FieldRow
            label="Industry"
            value={result.job_industry_name}
            tooltip={
              <>
                <p className="font-semibold mb-1">Industry</p>
                <p>The sector the hiring company operates in (e.g. SaaS, BFSI, Healthcare). Inferred from the JD body and company context.</p>
              </>
            }
          />
          <FieldRow
            label="Seniority"
            value={result.seniority}
            tooltip={
              <>
                <p className="font-semibold mb-1">Seniority</p>
                <p>Career level inferred from years-of-experience cues, title prefixes ("Senior", "Lead"), and scope of ownership.</p>
              </>
            }
          />
          <FieldRow
            label="Company type"
            value={result.company_type}
            tooltip={
              <>
                <p className="font-semibold mb-1">Company type</p>
                <p>Org-shape signal (e.g. Startup, Enterprise, MNC, Agency) inferred from company size cues and the JD's tone.</p>
              </>
            }
          />
          <FieldRow
            label="Geography"
            value={result.geography}
            variant="outline"
            tooltip={
              <>
                <p className="font-semibold mb-1">Geography</p>
                <p>Primary work location or region. May be a city, region, or "Remote — India" depending on what the JD specifies.</p>
              </>
            }
          />
        </div>

        {/* Sub-role gets its own line + a richer tooltip — it's the field admins ask about most */}
        {result.sub_role && (
          <div className="flex items-center gap-1.5 text-sm">
            <span className="text-muted-foreground">Sub-role:</span>
            <InfoTooltip label="What is sub_role?">
              <p className="font-semibold mb-1">Sub-role</p>
              <p>
                A finer-grained specialisation within the job family — e.g. <em>Backend Engineer</em>{" "}
                inside <em>Software Engineering</em>, or <em>FP&amp;A</em> inside <em>Finance</em>.
              </p>
              <p className="mt-1.5 text-muted-foreground">
                Sub-roles are emitted by the LLM as free text; they are <span className="font-mono">not</span>{" "}
                governed by the bucket taxonomy. Use them as a hint, not a hard label.
              </p>
            </InfoTooltip>
            <span className="text-foreground font-medium">{result.sub_role}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

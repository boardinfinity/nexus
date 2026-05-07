// Experience / Education / CTC card — adds an "Extracted from JD by LLM" footnote
// so users know these numbers are pulled from the source text, not derived from
// market data or company benchmarks.
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sparkles } from "lucide-react";
import { InfoTooltip } from "./InfoTooltip";
import type { AnalyzeResult } from "./types";

interface ExperienceEducationCTCProps {
  result: AnalyzeResult;
}

export function ExperienceEducationCTC({ result }: ExperienceEducationCTCProps) {
  const expSpecified = result.experience_min != null || result.experience_max != null;
  const ctcSpecified = result.ctc_min != null || result.ctc_max != null;

  return (
    <Card data-testid="experience-education-ctc-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          Experience &amp; Education
          <InfoTooltip label="How are these numbers calculated?">
            <p className="font-semibold mb-1">How is this calculated?</p>
            <p>
              Experience range, education level and CTC are <strong>extracted directly from the JD text by the LLM</strong>{" "}
              — no market benchmarking or salary lookups are involved here.
            </p>
            <p className="mt-1.5 text-muted-foreground">
              If a field is missing, the JD did not state it explicitly. Use the salary lookup action
              below the result card to fetch market-rate CTC for the same role.
            </p>
          </InfoTooltip>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Experience</p>
            <p className="text-sm font-medium">
              {expSpecified
                ? `${result.experience_min ?? 0} – ${result.experience_max ?? "?"} years`
                : "Not specified"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Education</p>
            <p className="text-sm font-medium capitalize">
              {result.min_education || "Not specified"}
            </p>
            {result.preferred_fields.length > 0 && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {result.preferred_fields.join(", ")}
              </p>
            )}
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">CTC</p>
            <p className="text-sm font-medium">
              {ctcSpecified
                ? `₹${result.ctc_min ?? "?"} – ${result.ctc_max ?? "?"} LPA`
                : "Not stated in JD"}
            </p>
          </div>
        </div>

        <p className="mt-3 flex items-center gap-1 text-[10px] text-muted-foreground">
          <Sparkles className="h-3 w-3" />
          Extracted from JD by LLM
        </p>
      </CardContent>
    </Card>
  );
}

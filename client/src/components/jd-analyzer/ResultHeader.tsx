// Compact header strip shown above the result cards: filename, model, latency,
// and the JD-quality + classification-confidence badges (with tooltips).
import { Badge } from "@/components/ui/badge";
import { CheckCircle, FileText } from "lucide-react";
import { InfoTooltip } from "./InfoTooltip";
import type { AnalyzeResult } from "./types";

const qualityColors: Record<string, string> = {
  well_structured: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  adequate: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  poor: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

const qualityExplain: Record<string, string> = {
  well_structured:
    "The JD has clear sections (responsibilities, requirements, qualifications) and enough specific detail for high-confidence extraction.",
  adequate:
    "The JD has some structure but is missing detail in one or more areas (e.g. vague requirements). Extraction works but confidence is moderate.",
  poor:
    "The JD is very short, vague, or unstructured. Extracted fields may be incomplete or unreliable.",
};

interface ResultHeaderProps {
  result: AnalyzeResult;
}

export function ResultHeader({ result }: ResultHeaderProps) {
  const filename = result.filename;
  const model = result.model;
  const latency = result.latency_ms;
  const quality = result.jd_quality;
  const confidencePct = Math.round((result.classification_confidence || 0) * 100);

  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-muted/30 px-3 py-2"
      data-testid="result-header"
    >
      {filename && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground min-w-0">
          <FileText className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate font-medium text-foreground">{filename}</span>
        </div>
      )}

      {model && (
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <span className="uppercase tracking-wide">Model</span>
          <span className="font-mono text-foreground">{model}</span>
        </div>
      )}

      {typeof latency === "number" && latency > 0 && (
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <span className="uppercase tracking-wide">Latency</span>
          <span className="font-mono text-foreground">{(latency / 1000).toFixed(2)}s</span>
        </div>
      )}

      <div className="ml-auto flex items-center gap-2">
        {result.saved && (
          <Badge variant="outline" className="text-[10px] text-green-600 border-green-300">
            <CheckCircle className="h-3 w-3 mr-1" />
            Saved
          </Badge>
        )}

        {quality && (
          <div className="flex items-center gap-1">
            <Badge className={`text-[10px] ${qualityColors[quality] || ""}`}>
              {quality.replace(/_/g, " ")}
            </Badge>
            <InfoTooltip label="What does this quality rating mean?">
              <p className="font-semibold mb-1">JD quality: {quality.replace(/_/g, " ")}</p>
              <p>{qualityExplain[quality] || "Heuristic rating of how well-structured the source JD is."}</p>
              <p className="mt-1.5 text-muted-foreground">
                Rated by the LLM during classification based on section coverage and specificity.
              </p>
            </InfoTooltip>
          </div>
        )}

        {confidencePct > 0 && (
          <div className="flex items-center gap-1">
            <Badge variant="outline" className="text-[10px]">
              {confidencePct}% confidence
            </Badge>
            <InfoTooltip label="What does this confidence score mean?">
              <p className="font-semibold mb-1">Classification confidence: {confidencePct}%</p>
              <p>
                The LLM's self-reported confidence in the function / family / industry / seniority
                assignment. Derived from a coarse <span className="font-mono">low / medium / high</span>{" "}
                bucket the model emits, mapped to a numeric score.
              </p>
              <p className="mt-1.5 text-muted-foreground">
                Below ~60% means a human should sanity-check the classification before it's used to
                drive downstream campaigns or sourcing.
              </p>
            </InfoTooltip>
          </div>
        )}
      </div>
    </div>
  );
}

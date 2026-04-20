import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, RefreshCw, CheckCircle2, XCircle, Clock, Play, ExternalLink } from "lucide-react";
import { Link } from "wouter";
import { authFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface RunHistoryProps {
  pipelineTypes?: string[];
  limit?: number;
  title?: string;
}

export function RunHistory({ pipelineTypes, limit = 20, title = "Recent Runs" }: RunHistoryProps) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/pipelines"],
    refetchInterval: 15000, // Auto-refresh every 15s to catch status changes
  });

  const runs = (data?.data || data || [])
    .filter((r: any) => !pipelineTypes || pipelineTypes.includes(r.pipeline_type))
    .slice(0, limit);

  // Poll a running pipeline to check/process results
  const pollMutation = useMutation({
    mutationFn: async (runId: string) => {
      const res = await authFetch(`/api/pipelines/${runId}/poll`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["/api/pipelines"] });
      if (data.status === "completed") {
        toast({ title: "Pipeline completed", description: `${data.processed_items || 0} jobs processed` });
      }
    },
    onError: (e: any) => toast({ title: "Poll failed", description: e.message, variant: "destructive" }),
  });

  // Cancel a stuck/running pipeline
  const cancelMutation = useMutation({
    mutationFn: async (runId: string) => {
      const res = await authFetch(`/api/pipelines/${runId}/cancel`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/pipelines"] });
      toast({ title: "Pipeline cancelled" });
    },
    onError: (e: any) => toast({ title: "Cancel failed", description: e.message, variant: "destructive" }),
  });

  const statusIcon = (s: string) => {
    if (s === "completed") return <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />;
    if (s === "failed" || s === "cancelled") return <XCircle className="h-3.5 w-3.5 text-red-600" />;
    if (s === "running") return <Loader2 className="h-3.5 w-3.5 text-blue-600 animate-spin" />;
    return <Clock className="h-3.5 w-3.5 text-gray-400" />;
  };

  const statusColor = (s: string) =>
    s === "completed" ? "bg-green-50 text-green-700 border-green-200" :
    s === "failed" || s === "cancelled" ? "bg-red-50 text-red-700 border-red-200" :
    s === "running" ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-gray-50 text-gray-700 border-gray-200";

  const pipelineLabel = (type: string) => {
    const labels: Record<string, string> = {
      linkedin_jobs: "LinkedIn Jobs",
      google_jobs: "Google Jobs",
      alumni: "Alumni Search",
      jd_enrichment: "JD Enrichment",
      company_enrichment: "Company Enrichment",
      jd_batch_submit: "JD Batch",
    };
    return labels[type] || type;
  };

  const formatDuration = (start: string, end?: string) => {
    const s = new Date(start).getTime();
    const e = end ? new Date(end).getTime() : Date.now();
    const secs = Math.round((e - s) / 1000);
    if (secs < 60) return `${secs}s`;
    if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
    return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
  };

  const extractRunInfo = (run: any) => {
    const config = run.config || {};
    const roles = config._job_roles as { id?: string; name?: string }[] | undefined;
    const location = config.location || "—";
    const keywords = config.search_keywords || config.keywords;
    const roleNames = roles?.map(r => r.name).filter(Boolean) || [];
    const additionalRuns = config._additional_runs?.length || 0;

    return { location, keywords, roleNames, additionalRuns };
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => qc.invalidateQueries({ queryKey: ["/api/pipelines"] })}>
            <RefreshCw className="h-3 w-3 mr-1" /> Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : runs.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No runs yet</p>
        ) : (
          <div className="space-y-2">
            {runs.map((run: any) => {
              const info = extractRunInfo(run);
              const isRunning = run.status === "running";
              const apifyStatus = run._apify_status;

              return (
                <div key={run.id} className="rounded-lg border p-3 space-y-2">
                  {/* Row 1: Type + Status + Time */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {statusIcon(run.status)}
                      <span className="text-xs font-medium">{pipelineLabel(run.pipeline_type)}</span>
                      <Badge variant="outline" className={`text-[10px] border ${statusColor(run.status)}`}>
                        {run.status}{apifyStatus && isRunning ? ` (${apifyStatus.toLowerCase()})` : ""}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span>{run.started_at ? formatDuration(run.started_at, run.completed_at) : "—"}</span>
                      <span>{run.started_at ? new Date(run.started_at).toLocaleString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, day: "numeric", month: "short" }) : "—"}</span>
                    </div>
                  </div>

                  {/* Row 2: Config summary */}
                  <div className="flex flex-wrap gap-1.5 text-[10px]">
                    {info.roleNames.length > 0 && (
                      <Badge variant="secondary" className="text-[10px] font-normal">
                        {info.roleNames.length} role{info.roleNames.length > 1 ? "s" : ""}: {info.roleNames.slice(0, 3).join(", ")}{info.roleNames.length > 3 ? ` +${info.roleNames.length - 3}` : ""}
                      </Badge>
                    )}
                    {info.keywords && !info.roleNames.length && (
                      <Badge variant="secondary" className="text-[10px] font-normal">"{info.keywords}"</Badge>
                    )}
                    <Badge variant="outline" className="text-[10px] font-normal">{info.location}</Badge>
                    {info.additionalRuns > 0 && (
                      <Badge variant="outline" className="text-[10px] font-normal">{info.additionalRuns + 1} Apify runs</Badge>
                    )}
                  </div>

                  {/* Row 3: Stats */}
                  <div className="flex items-center justify-between">
                    <div className="flex gap-3 text-[10px]">
                      {(run.total_items != null) && (
                        <span className="text-muted-foreground">Scraped: <span className="text-foreground font-medium">{run.total_items}</span></span>
                      )}
                      {run.config?._validated_count != null && run.config._validated_count !== run.total_items && (
                        <span className="text-blue-600">Matched: <span className="font-medium">{run.config._validated_count}</span></span>
                      )}
                      {(run.processed_items != null && run.processed_items > 0) && (
                        <span className="text-green-600">Processed: <span className="font-medium">{run.processed_items}</span></span>
                      )}
                      {(run.skipped_items != null && run.skipped_items > 0) && (
                        <span className="text-amber-600">Duplicates: <span className="font-medium">{run.skipped_items}</span></span>
                      )}
                      {(run.failed_items != null && run.failed_items > 0) && (
                        <span className="text-red-600">Failed: <span className="font-medium">{run.failed_items}</span></span>
                      )}
                      {run.error_message && (
                        <span className="text-red-600 truncate max-w-[200px]" title={run.error_message}>{run.error_message}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {isRunning && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-6 text-[10px] px-2"
                            disabled={pollMutation.isPending}
                            onClick={() => pollMutation.mutate(run.id)}
                          >
                            {pollMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Play className="h-3 w-3 mr-1" />}
                            Check Status
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-6 text-[10px] px-2 text-red-600 hover:text-red-700 hover:bg-red-50"
                            disabled={cancelMutation.isPending}
                            onClick={() => cancelMutation.mutate(run.id)}
                          >
                            <XCircle className="h-3 w-3 mr-1" />
                            Cancel
                          </Button>
                        </>
                      )}
                      {run.status === "completed" && (run.processed_items || 0) > 0 && (
                        <Link
                          href={
                            run.pipeline_type === "alumni" || run.pipeline_type === "people_enrichment"
                              ? `/people`
                              : `/jobs?source=${run.pipeline_type === "linkedin_jobs" ? "linkedin" : run.pipeline_type === "google_jobs" ? "google_jobs" : ""}&added=${encodeURIComponent(run.started_at)}`
                          }
                        >
                          <Button variant="outline" size="sm" className="h-6 text-[10px] px-2">
                            <ExternalLink className="h-3 w-3 mr-1" /> {run.pipeline_type === "alumni" || run.pipeline_type === "people_enrichment" ? "View People" : "View Jobs"}
                          </Button>
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

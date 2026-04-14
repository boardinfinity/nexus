import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

interface RunHistoryProps {
  pipelineTypes?: string[];
  limit?: number;
  title?: string;
}

export function RunHistory({ pipelineTypes, limit = 20, title = "Recent Runs" }: RunHistoryProps) {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/pipelines"],
  });

  const runs = (data?.data || data || [])
    .filter((r: any) => !pipelineTypes || pipelineTypes.includes(r.pipeline_type))
    .slice(0, limit);

  const statusColor = (s: string) =>
    s === "completed" ? "bg-green-100 text-green-800" :
    s === "failed" ? "bg-red-100 text-red-800" :
    s === "running" ? "bg-blue-100 text-blue-800" : "bg-gray-100 text-gray-800";

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : runs.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No runs yet</p>
        ) : (
          <div className="space-y-1.5">
            {runs.map((run: any) => (
              <div key={run.id} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/50 text-xs">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px] font-mono">{run.pipeline_type}</Badge>
                  <span className="text-muted-foreground">{run.processed_items || 0}/{run.total_items || 0}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={`${statusColor(run.status)} text-[10px] border-0`}>{run.status}</Badge>
                  <span className="text-muted-foreground">{run.started_at ? new Date(run.started_at).toLocaleString() : "—"}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

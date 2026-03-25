import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Clock, Plus, Pause, Play, Pencil, Trash2, Loader2, CheckCircle2, XCircle, CalendarClock, Info, ChevronDown,
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import cronstrue from "cronstrue";

interface Schedule {
  id: string;
  name: string;
  pipeline_type: string;
  config: any;
  frequency: string;
  cron_expression: string | null;
  is_active: boolean;
  max_runs: number | null;
  total_runs: number;
  last_run_at: string | null;
  last_run_status: string | null;
  next_run_at: string | null;
  credit_limit: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const PIPELINE_TYPES = [
  { value: "google_jobs", label: "Google Jobs" },
  { value: "linkedin_jobs", label: "LinkedIn Jobs" },
  { value: "alumni", label: "Alumni Search" },
  { value: "jd_enrichment", label: "JD Enrichment" },
  { value: "people_enrichment", label: "People Enrichment" },
  { value: "company_enrichment", label: "Company Enrichment" },
];

const FREQUENCIES = [
  { value: "hourly", label: "Hourly" },
  { value: "every_6h", label: "Every 6 Hours" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "custom", label: "Custom Cron" },
];

function frequencyLabel(frequency: string, cron_expression?: string | null): string {
  if (frequency === "custom" && cron_expression) {
    try {
      return cronstrue.toString(cron_expression);
    } catch {
      return cron_expression;
    }
  }
  return FREQUENCIES.find(f => f.value === frequency)?.label || frequency;
}

function pipelineTypeLabel(type: string): string {
  return PIPELINE_TYPES.find(p => p.value === type)?.label || type;
}

function PipelineConfigFields({ pipelineType, config, onChange }: {
  pipelineType: string;
  config: any;
  onChange: (config: any) => void;
}) {
  const update = (key: string, value: any) => onChange({ ...config, [key]: value });

  switch (pipelineType) {
    case "google_jobs":
      return (
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Search Queries (one per line)</Label>
            <Textarea className="text-xs min-h-[80px]" placeholder="Financial Analyst Dubai"
              value={config.queries?.join?.("\n") || config.queries || ""}
              onChange={(e) => update("queries", e.target.value.split("\n").filter(Boolean))} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Country</Label>
              <Input className="h-8 text-xs" placeholder="e.g. AE, IN, US"
                value={config.country || ""} onChange={(e) => update("country", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Pages per Query</Label>
              <Input type="number" className="h-8 text-xs" min={1} max={10}
                value={config.pages_per_query || 3} onChange={(e) => update("pages_per_query", parseInt(e.target.value) || 3)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Date Posted</Label>
            <Select value={config.date_posted || "week"} onValueChange={(v) => update("date_posted", v)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any Time</SelectItem>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="3days">Past 3 Days</SelectItem>
                <SelectItem value="week">Past Week</SelectItem>
                <SelectItem value="month">Past Month</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      );
    case "linkedin_jobs":
      return (
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Search Keywords (one per line)</Label>
            <Textarea className="text-xs min-h-[80px]" placeholder="software engineer"
              value={config.search_keywords || ""} onChange={(e) => update("search_keywords", e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Location</Label>
              <Input className="h-8 text-xs" placeholder="India"
                value={config.location || ""} onChange={(e) => update("location", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Date Posted</Label>
              <Select value={config.date_posted || "past month"} onValueChange={(v) => update("date_posted", v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="past month">Past Month</SelectItem>
                  <SelectItem value="past week">Past Week</SelectItem>
                  <SelectItem value="24hr">Past 24 Hours</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      );
    case "alumni":
      return (
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">School URLs / Slugs (one per line)</Label>
            <Textarea className="text-xs min-h-[80px]" placeholder="iit-bombay"
              value={config.university_slug || ""} onChange={(e) => update("university_slug", e.target.value)} />
          </div>
        </div>
      );
    case "jd_enrichment":
    case "people_enrichment":
    case "company_enrichment":
      return (
        <div className="space-y-1">
          <Label className="text-xs">Batch Size</Label>
          <Input type="number" className="h-8 text-xs" placeholder="50" min={1}
            value={config.batch_size || 50} onChange={(e) => update("batch_size", parseInt(e.target.value) || 50)} />
        </div>
      );
    default:
      return null;
  }
}

function ScheduleDialog({ open, onOpenChange, schedule }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schedule?: Schedule | null;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const isEdit = !!schedule;

  const [name, setName] = useState(schedule?.name || "");
  const [pipelineType, setPipelineType] = useState(schedule?.pipeline_type || "google_jobs");
  const [config, setConfig] = useState<any>(schedule?.config || {});
  const [frequency, setFrequency] = useState(schedule?.frequency || "daily");
  const [cronExpression, setCronExpression] = useState(schedule?.cron_expression || "");
  const [maxRuns, setMaxRuns] = useState(schedule?.max_runs?.toString() || "");
  const [creditLimit, setCreditLimit] = useState(schedule?.credit_limit?.toString() || "");

  const cronPreview = frequency === "custom" && cronExpression ? (() => {
    try { return cronstrue.toString(cronExpression); } catch { return "Invalid cron expression"; }
  })() : null;

  const mutation = useMutation({
    mutationFn: async () => {
      const body = {
        name,
        pipeline_type: pipelineType,
        config,
        frequency,
        cron_expression: frequency === "custom" ? cronExpression : undefined,
        max_runs: maxRuns ? parseInt(maxRuns) : null,
        credit_limit: creditLimit ? parseInt(creditLimit) : null,
      };
      if (isEdit) {
        const res = await apiRequest("PUT", `/api/schedules/${schedule.id}`, body);
        return res.json();
      } else {
        const res = await apiRequest("POST", "/api/schedules", body);
        return res.json();
      }
    },
    onSuccess: () => {
      toast({ title: isEdit ? "Schedule updated" : "Schedule created" });
      queryClient.invalidateQueries({ queryKey: ["/api/schedules"] });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Schedule" : "New Schedule"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Update the schedule configuration." : "Configure a recurring pipeline schedule."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label className="text-xs">Name</Label>
            <Input className="h-8 text-xs" placeholder="e.g. Daily Dubai Finance Jobs"
              value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Pipeline Type</Label>
            <Select value={pipelineType} onValueChange={(v) => { setPipelineType(v); setConfig({}); }}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PIPELINE_TYPES.map(p => (
                  <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-medium">Pipeline Configuration</Label>
            <PipelineConfigFields pipelineType={pipelineType} config={config} onChange={setConfig} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Frequency</Label>
            <Select value={frequency} onValueChange={setFrequency}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {FREQUENCIES.map(f => (
                  <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {frequency === "custom" && (
            <div className="space-y-1">
              <Label className="text-xs">Cron Expression</Label>
              <Input className="h-8 text-xs font-mono" placeholder="0 */6 * * *"
                value={cronExpression} onChange={(e) => setCronExpression(e.target.value)} />
              {cronPreview && (
                <p className="text-[11px] text-muted-foreground">{cronPreview}</p>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Max Runs</Label>
              <Input type="number" className="h-8 text-xs" placeholder="Unlimited" min={1}
                value={maxRuns} onChange={(e) => setMaxRuns(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Credit Limit</Label>
              <Input type="number" className="h-8 text-xs" placeholder="No limit" min={1}
                value={creditLimit} onChange={(e) => setCreditLimit(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !name}>
            {mutation.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
            {isEdit ? "Update" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Schedules() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editSchedule, setEditSchedule] = useState<Schedule | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ type: "pause" | "resume" | "delete"; schedule: Schedule } | null>(null);

  const { data: schedules, isLoading } = useQuery<Schedule[]>({
    queryKey: ["/api/schedules"],
    refetchInterval: 10000,
  });

  const pauseMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("POST", `/api/schedules/${id}/pause`);
    },
    onSuccess: () => {
      toast({ title: "Schedule paused" });
      queryClient.invalidateQueries({ queryKey: ["/api/schedules"] });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const resumeMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("POST", `/api/schedules/${id}/resume`);
    },
    onSuccess: () => {
      toast({ title: "Schedule resumed" });
      queryClient.invalidateQueries({ queryKey: ["/api/schedules"] });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/schedules/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Schedule deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/schedules"] });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleConfirm = () => {
    if (!confirmAction) return;
    const { type, schedule } = confirmAction;
    if (type === "pause") pauseMutation.mutate(schedule.id);
    else if (type === "resume") resumeMutation.mutate(schedule.id);
    else if (type === "delete") deleteMutation.mutate(schedule.id);
    setConfirmAction(null);
  };

  return (
    <div className="space-y-6" data-testid="schedules-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Pipeline Schedules</h1>
          <p className="text-sm text-muted-foreground">Manage recurring automated pipeline runs</p>
        </div>
        <Button onClick={() => { setEditSchedule(null); setDialogOpen(true); }}>
          <Plus className="h-4 w-4 mr-1" /> New Schedule
        </Button>
      </div>

      <Collapsible>
        <CollapsibleTrigger className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <Info className="h-3.5 w-3.5" />
          <span>How this works</span>
          <ChevronDown className="h-3.5 w-3.5" />
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-3">
          <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground space-y-2">
            <p><strong>How this works:</strong></p>
            <p>• Schedules automate pipeline runs on a recurring basis</p>
            <p>• The daily cron runs at midnight UTC and triggers any configured schedules</p>
            <p>• Each schedule runs the specified pipeline with its saved configuration</p>
            <p className="pt-1"><strong>How to set up:</strong></p>
            <p>1. Create a schedule with pipeline type and configuration</p>
            <p>2. Set frequency (daily is recommended for job collection)</p>
            <p>3. The scheduler checks at midnight UTC and runs all active schedules</p>
            <p className="pt-1"><strong>Limitations:</strong></p>
            <p>• Minimum frequency is daily (the cron runs once per day at midnight UTC)</p>
            <p>• If a pipeline fails during a scheduled run, check Pipeline Run History for errors</p>
            <p>• Scheduled runs count toward your API credit usage</p>
            <p>• If a schedule shows 0/0 results, the pipeline may have encountered an error — check the Pipelines page for details</p>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !schedules?.length ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <CalendarClock className="h-10 w-10 text-muted-foreground mb-3" />
            <h3 className="font-medium">No schedules yet</h3>
            <p className="text-sm text-muted-foreground mt-1">Create a schedule to automate recurring pipeline runs.</p>
            <Button className="mt-4" onClick={() => { setEditSchedule(null); setDialogOpen(true); }}>
              <Plus className="h-4 w-4 mr-1" /> Create Schedule
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {schedules.map((s) => (
            <Card key={s.id} className="relative">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div className="space-y-1 min-w-0 flex-1">
                    <CardTitle className="text-sm truncate">{s.name}</CardTitle>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">
                        {pipelineTypeLabel(s.pipeline_type)}
                      </Badge>
                      {s.is_active ? (
                        <Badge variant="outline" className="text-[10px] bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400 border-0">
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-0">
                          Paused
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-xs">
                <div className="grid grid-cols-2 gap-y-2 text-muted-foreground">
                  <div>
                    <span className="block text-[10px] uppercase tracking-wider">Frequency</span>
                    <span className="text-foreground">{frequencyLabel(s.frequency, s.cron_expression)}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase tracking-wider">Runs</span>
                    <span className="text-foreground">
                      {s.total_runs}{s.max_runs ? ` / ${s.max_runs}` : " / \u221e"}
                    </span>
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase tracking-wider">Last Run</span>
                    <span className="text-foreground flex items-center gap-1">
                      {s.last_run_at ? (
                        <>
                          {s.last_run_status === "completed" || s.last_run_status === "complete" || s.last_run_status === "success" ? (
                            <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                          ) : s.last_run_status === "failed" ? (
                            <XCircle className="h-3 w-3 text-red-500" />
                          ) : null}
                          {new Date(s.last_run_at).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </>
                      ) : "Never"}
                    </span>
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase tracking-wider">Next Run</span>
                    <span className="text-foreground">
                      {s.is_active && s.next_run_at
                        ? new Date(s.next_run_at).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
                        : "Paused"}
                    </span>
                  </div>
                </div>
                <div className="flex gap-1.5 pt-1 border-t">
                  {s.is_active ? (
                    <Button variant="outline" size="sm" className="h-7 text-[11px] flex-1"
                      onClick={() => setConfirmAction({ type: "pause", schedule: s })}>
                      <Pause className="h-3 w-3 mr-1" /> Pause
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" className="h-7 text-[11px] flex-1"
                      onClick={() => setConfirmAction({ type: "resume", schedule: s })}>
                      <Play className="h-3 w-3 mr-1" /> Resume
                    </Button>
                  )}
                  <Button variant="outline" size="sm" className="h-7 text-[11px]"
                    onClick={() => { setEditSchedule(s); setDialogOpen(true); }}>
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 text-[11px] text-red-600 hover:text-red-700"
                    onClick={() => setConfirmAction({ type: "delete", schedule: s })}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      {dialogOpen && (
        <ScheduleDialog
          open={dialogOpen}
          onOpenChange={(open) => { setDialogOpen(open); if (!open) setEditSchedule(null); }}
          schedule={editSchedule}
        />
      )}

      {/* Confirmation Dialog */}
      <AlertDialog open={!!confirmAction} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction?.type === "pause" && "Pause Schedule"}
              {confirmAction?.type === "resume" && "Resume Schedule"}
              {confirmAction?.type === "delete" && "Delete Schedule"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction?.type === "pause" && `Are you sure you want to pause "${confirmAction.schedule.name}"? It will stop triggering until resumed.`}
              {confirmAction?.type === "resume" && `Resume "${confirmAction?.schedule.name}"? It will start triggering again based on its frequency.`}
              {confirmAction?.type === "delete" && `Permanently delete "${confirmAction?.schedule.name}"? This action cannot be undone. Existing pipeline runs will be preserved but unlinked.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm}>
              {confirmAction?.type === "delete" ? "Delete" : confirmAction?.type === "pause" ? "Pause" : "Resume"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Play, Loader2 } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { LucideIcon } from "lucide-react";

interface PipelineTriggerProps {
  type: string;
  title: string;
  description: string;
  icon: LucideIcon;
  fields: Array<{
    name: string;
    label: string;
    type: "text" | "number" | "select";
    placeholder?: string;
    options?: { value: string; label: string }[];
    defaultValue?: string;
  }>;
}

export function PipelineTrigger({ type, title, description, icon: Icon, fields }: PipelineTriggerProps) {
  const [config, setConfig] = useState<Record<string, string>>(() => {
    const defaults: Record<string, string> = {};
    fields.forEach((f) => {
      if (f.defaultValue) defaults[f.name] = f.defaultValue;
    });
    return defaults;
  });
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/pipelines/run", {
        pipeline_type: type,
        config,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Pipeline started", description: `${title} pipeline has been triggered.` });
      queryClient.invalidateQueries({ queryKey: ["/api/pipelines"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/pipeline-activity"] });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to start pipeline", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Card data-testid={`pipeline-trigger-${type}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-primary/10 p-2">
            <Icon className="h-4 w-4 text-primary" />
          </div>
          <div>
            <CardTitle className="text-sm">{title}</CardTitle>
            <p className="text-xs text-muted-foreground">{description}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {fields.map((field) => (
          <div key={field.name} className="space-y-1">
            <Label className="text-xs">{field.label}</Label>
            {field.type === "select" ? (
              <Select
                value={config[field.name] || ""}
                onValueChange={(v) => setConfig((p) => ({ ...p, [field.name]: v }))}
              >
                <SelectTrigger className="h-8 text-xs" data-testid={`field-${field.name}`}>
                  <SelectValue placeholder={field.placeholder} />
                </SelectTrigger>
                <SelectContent>
                  {field.options?.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                type={field.type}
                className="h-8 text-xs"
                placeholder={field.placeholder}
                value={config[field.name] || ""}
                onChange={(e) => setConfig((p) => ({ ...p, [field.name]: e.target.value }))}
                data-testid={`field-${field.name}`}
              />
            )}
          </div>
        ))}
        <Button
          className="w-full h-8 text-xs"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          data-testid={`run-${type}`}
        >
          {mutation.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin mr-1" />
          ) : (
            <Play className="h-3 w-3 mr-1" />
          )}
          Run Pipeline
        </Button>
      </CardContent>
    </Card>
  );
}

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Eye, EyeOff, Save } from "lucide-react";
import type { ProviderCredit } from "@shared/schema";

function MaskedKeyField({ label, value, testId }: { label: string; value: string; testId: string }) {
  const [visible, setVisible] = useState(false);
  const masked = value ? value.slice(0, 8) + "..." + value.slice(-4) : "Not configured";

  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          readOnly
          className="h-8 text-xs font-mono"
          value={visible ? value : masked}
          data-testid={testId}
        />
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={() => setVisible(!visible)}
          data-testid={`toggle-${testId}`}
        >
          {visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  );
}

export default function Settings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: credits } = useQuery<ProviderCredit[]>({
    queryKey: ["/api/providers/credits"],
  });

  const [budgets, setBudgets] = useState<Record<string, string>>({});

  const updateBudget = useMutation({
    mutationFn: async ({ provider, allocated }: { provider: string; allocated: number }) => {
      const res = await fetch("/api/providers/credits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, credits_allocated: allocated }),
      });
      if (!res.ok) throw new Error("Failed to update budget");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Budget updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/providers/credits"] });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-6" data-testid="settings-page">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage provider keys, schedules, and budgets</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Provider API Keys</CardTitle>
          <CardDescription className="text-xs">
            API keys are stored server-side. Values shown here are masked for security.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <MaskedKeyField
            label="Apify API Key"
            value={process.env.APIFY_API_KEY || "apify_api_kMa...1g4gy8"}
            testId="key-apify"
          />
          <MaskedKeyField
            label="RapidAPI Key"
            value={process.env.RAPIDAPI_KEY || "5ce8450...914e"}
            testId="key-rapidapi"
          />
          <MaskedKeyField
            label="Supabase Service Key"
            value="eyJhbGci...RgU"
            testId="key-supabase"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Credit Budget Allocation</CardTitle>
          <CardDescription className="text-xs">
            Set monthly credit limits per provider to control spend.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {credits?.map((c) => (
            <div key={c.provider} className="flex items-end gap-3">
              <div className="flex-1 space-y-1">
                <Label className="text-xs capitalize">{c.provider}</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    className="h-8 text-xs"
                    placeholder={String(c.credits_allocated)}
                    value={budgets[c.provider] ?? ""}
                    onChange={(e) => setBudgets({ ...budgets, [c.provider]: e.target.value })}
                    data-testid={`budget-${c.provider}`}
                  />
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    Used: {c.credits_used?.toLocaleString()}
                  </span>
                </div>
              </div>
              <Button
                size="sm"
                className="h-8"
                disabled={!budgets[c.provider]}
                onClick={() =>
                  updateBudget.mutate({
                    provider: c.provider,
                    allocated: Number(budgets[c.provider]),
                  })
                }
                data-testid={`save-budget-${c.provider}`}
              >
                <Save className="h-3 w-3 mr-1" />
                Save
              </Button>
            </div>
          )) ?? (
            <p className="text-sm text-muted-foreground">No provider credits configured yet.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pipeline Schedules</CardTitle>
          <CardDescription className="text-xs">
            Configure automated pipeline execution schedules.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {[
            { name: "LinkedIn Jobs Scrape", schedule: "Daily at 6:00 AM IST", active: true },
            { name: "Google Jobs Search", schedule: "Every 6 hours", active: true },
            { name: "Company Enrichment", schedule: "Daily at 2:00 AM IST", active: false },
            { name: "JD Enrichment", schedule: "Hourly", active: false },
          ].map((s) => (
            <div key={s.name} className="flex items-center justify-between py-2 border-b last:border-0">
              <div>
                <p className="text-sm font-medium">{s.name}</p>
                <p className="text-xs text-muted-foreground">{s.schedule}</p>
              </div>
              <span className={`text-xs font-medium ${s.active ? "text-emerald-600" : "text-muted-foreground"}`}>
                {s.active ? "Active" : "Inactive"}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

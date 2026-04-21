import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Info, ChevronDown, CheckCircle2, XCircle, ExternalLink } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

type ProviderInfo = {
  configured: boolean;
  key_preview: string | null;
  usage?: { used?: number; limit?: number; plan?: string };
};

type ProvidersResponse = {
  apify: ProviderInfo;
  openai: ProviderInfo;
  anthropic: ProviderInfo;
  resend: ProviderInfo;
};

function ProviderRow({
  name,
  description,
  usedFor,
  data,
  docsUrl,
}: {
  name: string;
  description: string;
  usedFor: string;
  data: ProviderInfo | undefined;
  docsUrl?: string;
}) {
  const configured = data?.configured;
  return (
    <div className="rounded-lg border p-4 space-y-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">{name}</h3>
            {configured ? (
              <Badge className="h-5 bg-emerald-100 text-emerald-700 hover:bg-emerald-100 text-[10px] border-emerald-200">
                <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" /> Configured
              </Badge>
            ) : (
              <Badge variant="destructive" className="h-5 text-[10px]">
                <XCircle className="h-2.5 w-2.5 mr-0.5" /> Missing
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
          <p className="text-[10px] text-muted-foreground mt-1">
            <span className="font-medium">Used for:</span> {usedFor}
          </p>
        </div>
        {docsUrl && (
          <a href={docsUrl} target="_blank" rel="noreferrer" className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-0.5 shrink-0 mt-1">
            Docs <ExternalLink className="h-2.5 w-2.5" />
          </a>
        )}
      </div>
      <div className="font-mono text-[11px] text-muted-foreground bg-muted/30 rounded px-2 py-1">
        {data?.key_preview || "(not set)"}
      </div>
    </div>
  );
}

function ApifyUsageCard({ usage }: { usage?: { used?: number; limit?: number; plan?: string } }) {
  if (!usage || !usage.limit) return null;
  const used = usage.used ?? 0;
  const limit = usage.limit;
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const color = pct > 90 ? "bg-red-500" : pct > 70 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="rounded-lg border p-4 space-y-2.5 bg-gradient-to-br from-blue-50/50 to-background dark:from-blue-950/20">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Apify Monthly Usage</h3>
          <p className="text-[11px] text-muted-foreground">
            {usage.plan ? `${usage.plan} plan` : "Current billing period"}
          </p>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold">${used.toFixed(2)}</p>
          <p className="text-[10px] text-muted-foreground">of ${limit}</p>
        </div>
      </div>
      <div className="h-2 w-full rounded-full bg-muted/50 overflow-hidden">
        <div className={`h-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{pct}% consumed</span>
        <span>${(limit - used).toFixed(2)} remaining</span>
      </div>
    </div>
  );
}

export default function Settings() {
  const { data: providers, isLoading } = useQuery<ProvidersResponse>({
    queryKey: ["/api/settings/providers"],
    queryFn: async () => {
      const res = await authFetch("/api/settings/providers");
      if (!res.ok) throw new Error("Failed to fetch providers");
      return res.json();
    },
    refetchInterval: 60000, // refresh usage every minute
  });

  return (
    <div className="space-y-6" data-testid="settings-page">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Provider API keys and platform configuration</p>
      </div>

      <Collapsible>
        <CollapsibleTrigger className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <Info className="h-3.5 w-3.5" />
          <span>How this works</span>
          <ChevronDown className="h-3.5 w-3.5" />
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-3">
          <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground space-y-1.5">
            <p>• All API keys are stored as Vercel environment variables — never in the database</p>
            <p>• Key previews show the first 8 and last 6 characters for verification</p>
            <p>• To change a key: update in <a href="https://vercel.com/board-infinity/nexus/settings/environment-variables" target="_blank" rel="noreferrer" className="underline hover:text-foreground">Vercel dashboard</a>, then redeploy</p>
            <p>• Apify usage refreshes automatically every minute from the Apify API</p>
          </div>
        </CollapsibleContent>
      </Collapsible>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Provider API Keys</CardTitle>
          <CardDescription className="text-xs">
            External services powering Nexus. Keys are masked for security.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : (
            <>
              <ApifyUsageCard usage={providers?.apify.usage} />

              <ProviderRow
                name="Apify"
                description="All LinkedIn Jobs, Google Jobs, and LinkedIn profile scraping"
                usedFor="LinkedIn Jobs scraper, Google Jobs scraper, LinkedIn Profile scraper, LinkedIn Profile search"
                data={providers?.apify}
                docsUrl="https://console.apify.com/account/integrations"
              />

              <ProviderRow
                name="OpenAI"
                description="JD classification, skill extraction, catalog normalization"
                usedFor="JD Analyzer, Skill extraction, Taxonomy mapping (GPT-4.1 / GPT-5.4 / batch API)"
                data={providers?.openai}
                docsUrl="https://platform.openai.com/api-keys"
              />

              <ProviderRow
                name="Anthropic"
                description="Report generation and long-form analysis"
                usedFor="Claude Sonnet 4.6 reports"
                data={providers?.anthropic}
                docsUrl="https://console.anthropic.com/settings/keys"
              />

              <ProviderRow
                name="Resend"
                description="Transactional email (OTP verification)"
                usedFor="Survey OTP emails, PlaceIntel email verification"
                data={providers?.resend}
                docsUrl="https://resend.com/api-keys"
              />
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Data Sources</CardTitle>
          <CardDescription className="text-xs">
            Nexus uses Apify as the sole data provider for all web scraping.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">LinkedIn Jobs</span>
              <span className="text-xs text-muted-foreground font-mono">practicaltools/linkedin-jobs</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">Google Jobs</span>
              <span className="text-xs text-muted-foreground font-mono">igview-owner/google-jobs-scraper</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">LinkedIn Profile Search</span>
              <span className="text-xs text-muted-foreground font-mono">harvestapi/linkedin-profile-search</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">LinkedIn Profile Scraper</span>
              <span className="text-xs text-muted-foreground font-mono">harvestapi/linkedin-profile-scraper</span>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground mt-3">
            Schedule configuration: see <a href="/#/schedules" className="underline hover:text-foreground">Schedules</a> page
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

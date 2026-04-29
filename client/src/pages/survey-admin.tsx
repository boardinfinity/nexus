import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkles } from "lucide-react";

// Survey Admin v2 — placeholder.
// The full multi-survey admin (Surveys list, AI generator wizard, per-survey
// detail tabs Overview/Invites/Respondents/Analytics, SPOC scoping) is being
// rebuilt and ships in the next commit. The legacy single-survey admin has
// been removed; the legacy MBA-skills survey is preserved as an archived row
// in the database (slug: legacy-mba-skills, status: archived) but is no
// longer reachable from the UI.

export default function SurveyAdmin() {
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Surveys</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Multi-survey admin with AI-assisted survey builder.
          </p>
        </div>
        <Badge variant="secondary" className="gap-1">
          <Sparkles className="h-3 w-3" /> Coming soon
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Survey Admin v2</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            The multi-survey admin is being rebuilt. Once it ships you will be
            able to:
          </p>
          <ul className="list-disc list-inside space-y-1">
            <li>Create surveys from a brief, an uploaded document, or by cloning an existing one.</li>
            <li>Define sections and questions with 10 supported question types.</li>
            <li>Send invites in bulk via Mandrill, track opens, sends, and completions.</li>
            <li>View per-survey dashboards with response and skill-rating analytics.</li>
            <li>Scope visibility to college SPOCs (view + invite only).</li>
          </ul>
          <p>
            Public survey URLs follow the pattern{" "}
            <code className="bg-muted px-1.5 py-0.5 rounded text-xs">/#/s/&lt;slug&gt;</code>.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

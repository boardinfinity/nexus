import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Briefcase, Brain, Users, ShieldCheck, Building2, ChevronRight } from "lucide-react";
import { RunHistory } from "./run-history";

const categories = [
  {
    title: "Job Collection",
    description: "Scrape jobs from LinkedIn and Google with rich filters",
    icon: Briefcase,
    href: "/pipelines/jobs",
    color: "text-blue-600 bg-blue-50",
    types: ["linkedin_jobs", "google_jobs"],
  },
  {
    title: "JD Intelligence",
    description: "Analyze, classify, and extract skills from job descriptions",
    icon: Brain,
    href: "/pipelines/jd",
    color: "text-purple-600 bg-purple-50",
    types: ["jd_enrichment", "jd_fetch", "jd_batch_submit", "jd_batch_poll"],
  },
  {
    title: "People & Alumni",
    description: "Search and enrich LinkedIn alumni profiles",
    icon: Users,
    href: "/pipelines/people",
    color: "text-teal-600 bg-teal-50",
    types: ["alumni", "people_enrichment"],
  },
  {
    title: "Data Quality",
    description: "Deduplication, co-occurrence, and job status checks",
    icon: ShieldCheck,
    href: "/pipelines/quality",
    color: "text-amber-600 bg-amber-50",
    types: ["deduplication", "cooccurrence", "job_status_check"],
  },
  {
    title: "Company Intelligence",
    description: "Enrich company profiles with external data",
    icon: Building2,
    href: "/pipelines/companies",
    color: "text-emerald-600 bg-emerald-50",
    types: ["company_enrichment"],
  },
];

export default function PipelinesOverview() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Pipelines</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage data collection, processing, and enrichment pipelines</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {categories.map((cat) => (
          <Link key={cat.href} href={cat.href}>
            <Card className="cursor-pointer hover:shadow-md transition-shadow h-full">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className={`p-2 rounded-lg ${cat.color}`}>
                    <cat.icon className="h-5 w-5" />
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
                <CardTitle className="text-base mt-2">{cat.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">{cat.description}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <RunHistory limit={25} title="Recent Pipeline Runs" />
    </div>
  );
}

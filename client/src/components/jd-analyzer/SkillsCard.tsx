// SkillsCard — renders extracted skills grouped by L1 (TECHNICAL SKILLS, KNOWLEDGE,
// COMPETENCIES, CREDENTIAL). Each chip shows the skill name + its L2 sub-category
// (Tool, Methodology, Domain, etc.) and is colour-coded by L1. Includes badges for
// taxonomy_match, auto-created (is_new), and required-vs-nice-to-have.
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, Sparkles } from "lucide-react";
import { InfoTooltip } from "./InfoTooltip";
import { cn } from "@/lib/utils";
import { type AnalyzeSkill, type AnalyzeResult, deriveL1L2, l1Color, L1_COLORS } from "./types";

interface SkillsCardProps {
  result: AnalyzeResult;
}

const L1_DESCRIPTIONS: Record<string, string> = {
  "TECHNICAL SKILLS":
    "Tools, technologies, programming languages, and methodologies a candidate uses hands-on.",
  "KNOWLEDGE":
    "Domain knowledge or subject-matter expertise — what the candidate needs to know about the field.",
  "COMPETENCIES":
    "Behavioural skills, abilities, and ways of working — communication, leadership, problem-solving.",
  "CREDENTIAL":
    "Certifications, licences, and formal qualifications.",
};

const L1_ORDER = ["TECHNICAL SKILLS", "KNOWLEDGE", "COMPETENCIES", "CREDENTIAL"];

interface SkillRowProps {
  skill: AnalyzeSkill;
}

function SkillRow({ skill }: SkillRowProps) {
  const { l1, l2 } = deriveL1L2(skill);
  return (
    <div className="flex items-center justify-between gap-2 p-2 rounded border" data-testid="skill-row">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-sm font-medium truncate">{skill.name}</span>
        <Badge
          variant="outline"
          className={cn("text-[10px] shrink-0 font-normal", l1Color(l1))}
          title={`${l1} · ${l2}`}
        >
          {l2}
        </Badge>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <Badge variant={skill.required ? "default" : "outline"} className="text-[10px]">
          {skill.required ? "Required" : "Nice-to-have"}
        </Badge>
        {skill.is_new ? (
          <span className="inline-flex items-center gap-1">
            <Badge
              variant="outline"
              className="text-[10px] text-orange-700 border-orange-300 bg-orange-50 dark:bg-orange-900/30 dark:text-orange-200 dark:border-orange-800"
            >
              auto-created
            </Badge>
            <InfoTooltip label="What does auto-created mean?">
              <p className="font-semibold mb-1">Auto-created skill</p>
              <p>
                This skill wasn't found in the existing taxonomy, so it was created on the fly.
                It will surface in the new-skills review queue for an admin to validate and merge
                or rename.
              </p>
            </InfoTooltip>
          </span>
        ) : skill.taxonomy_match ? (
          <span className="inline-flex items-center gap-1">
            <Badge
              variant="outline"
              className="text-[10px] text-green-700 border-green-300 bg-green-50 dark:bg-green-900/30 dark:text-green-200 dark:border-green-800"
            >
              <CheckCircle className="h-2.5 w-2.5 mr-0.5" />
              taxonomy match
            </Badge>
            <InfoTooltip label="What does taxonomy match mean?">
              <p className="font-semibold mb-1">Taxonomy match</p>
              <p>
                The extracted skill resolved to an existing entry in the governed Nexus skill
                taxonomy. Mappings using this skill are stable and safe to query.
              </p>
            </InfoTooltip>
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function SkillsCard({ result }: SkillsCardProps) {
  const skills = result.skills || [];

  // Group by L1
  const byL1: Record<string, AnalyzeSkill[]> = {};
  for (const s of skills) {
    const { l1 } = deriveL1L2(s);
    (byL1[l1] = byL1[l1] || []).push(s);
  }

  // Order groups: known L1 first in a fixed order, then any leftover
  const orderedKeys = [
    ...L1_ORDER.filter(k => byL1[k]?.length),
    ...Object.keys(byL1).filter(k => !L1_ORDER.includes(k)),
  ];

  // Sort each group: required first, then alphabetical
  for (const k of orderedKeys) {
    byL1[k].sort((a, b) => {
      if (a.required !== b.required) return a.required ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  return (
    <Card data-testid="skills-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
          <span>Skills</span>
          <Badge variant="secondary">{result.total}</Badge>
          <InfoTooltip label="How are skills extracted?">
            <p className="font-semibold mb-1">Skill extraction</p>
            <p>
              Skills are extracted from the JD by the LLM, then matched against the Nexus skill
              taxonomy ({Object.keys(L1_COLORS).length} L1 categories, ~10k skills). Unmatched
              skills are auto-created and queued for admin review.
            </p>
            <p className="mt-1.5 text-muted-foreground">
              Each chip shows the skill's L2 sub-category (Tool, Methodology, Domain, etc.) and is
              colour-coded by L1.
            </p>
          </InfoTooltip>
        </CardTitle>

        {/* L1 legend */}
        <div className="flex flex-wrap gap-1.5 pt-2">
          {L1_ORDER.map(l1 => (
            <span key={l1} className="inline-flex items-center gap-1">
              <Badge variant="outline" className={cn("text-[10px] font-normal", l1Color(l1))}>
                {l1}
              </Badge>
              <InfoTooltip label={`What is ${l1}?`} className="opacity-60 hover:opacity-100">
                <p className="font-semibold mb-1">{l1}</p>
                <p>{L1_DESCRIPTIONS[l1]}</p>
              </InfoTooltip>
            </span>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {orderedKeys.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No skills extracted</p>
        ) : (
          orderedKeys.map(l1 => {
            const items = byL1[l1];
            const requiredCount = items.filter(s => s.required).length;
            return (
              <div key={l1}>
                <h3 className="text-xs font-semibold uppercase mb-2 flex items-center gap-1.5">
                  <span className={cn("inline-block h-2 w-2 rounded-full", l1Color(l1).split(" ")[0])} />
                  <span>{l1}</span>
                  <span className="text-muted-foreground font-normal">
                    ({items.length}
                    {requiredCount > 0 && requiredCount < items.length
                      ? ` · ${requiredCount} required`
                      : ""}
                    )
                  </span>
                </h3>
                <div className="space-y-1.5">
                  {items.map((skill, i) => (
                    <SkillRow key={`${l1}-${i}-${skill.name}`} skill={skill} />
                  ))}
                </div>
              </div>
            );
          })
        )}

        <p className="mt-3 flex items-center gap-1 text-[10px] text-muted-foreground border-t pt-2">
          <Sparkles className="h-3 w-3" />
          Skills extracted by LLM and matched against the Nexus taxonomy.
        </p>
      </CardContent>
    </Card>
  );
}

import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { StarRating } from "@/components/star-rating";
import {
  fetchProgress,
  fetchSkillList,
  fetchMyResponses,
  saveResponses,
  hasSurveyToken,
  clearSurveyToken,
} from "@/lib/survey-api";
import {
  Loader2, User, Briefcase, BarChart3, TrendingUp, Target,
  ChevronLeft, ChevronRight, Check, Plus, X, LogOut, CheckCircle2,
} from "lucide-react";

// ==================== CONSTANTS ====================

const SECTIONS = [
  { key: "profile", label: "A Profile", icon: User },
  { key: "hiring_overview", label: "B Hiring", icon: Briefcase },
  { key: "skill_ratings", label: "C Skills", icon: BarChart3 },
  { key: "gap_analysis", label: "D Gap", icon: Target },
  { key: "emerging_trends", label: "E Trends", icon: TrendingUp },
] as const;

const INDUSTRIES = ["BFSI", "Consulting", "Tech", "FMCG", "Healthcare", "Manufacturing", "Other"];
const COMPANY_SIZES = ["1-10", "11-50", "51-200", "201-1000", "1000+"];

const MBA_ROLES = [
  "Management Consultant", "Business Analyst", "Product Manager", "Marketing Manager",
  "Brand Manager", "Investment Banker", "Equity Research Analyst", "Corporate Finance Analyst",
  "Operations Manager", "Supply Chain Manager", "HR Business Partner", "Strategy Analyst",
  "Sales Manager", "Account Manager", "Project Manager", "Data Analyst",
  "Business Development Manager", "Financial Planner", "Risk Analyst", "General Management Trainee",
];

const REJECTION_REASONS = [
  "Lack of practical skills", "Poor communication skills", "Unrealistic salary expectations",
  "No relevant work experience", "Weak analytical thinking", "Poor cultural fit",
  "Lack of industry knowledge", "Weak leadership potential", "Poor problem-solving skills",
  "Inadequate technical skills",
];

const INSTITUTION_PREFS = ["Tier 1 only", "Tier 2 preferred", "Any accredited institution"];

const SKILL_GAP_AREAS = [
  "Financial Modeling", "Data Analysis & Visualization", "Communication Skills",
  "Leadership & People Management", "Strategic Thinking", "Digital Marketing",
  "AI/ML Understanding", "Project Management", "Negotiation Skills",
  "Industry-specific Knowledge", "Excel & Spreadsheet Skills", "Presentation Skills",
  "Critical Thinking", "Business Writing", "Cross-functional Collaboration",
];

const TRAINING_OPTIONS = [
  "Structured onboarding program", "Mentorship/buddy system", "Technical skills bootcamp",
  "Soft skills workshops", "Online learning platform access", "On-the-job training",
  "External certification support", "Leadership development program",
];

const PRODUCTIVITY_OPTIONS = ["Less than 1 month", "1-3 months", "3-6 months", "6+ months"];

const AI_IMPACT_OPTIONS = [
  "Significantly reducing hiring needs", "Somewhat reducing hiring needs",
  "No significant change", "Significantly increasing complexity of roles",
  "Replacing entire role categories",
];

// ==================== TYPES ====================

type SectionKey = typeof SECTIONS[number]["key"];

interface ProfileData {
  full_name: string;
  company_name: string;
  designation: string;
  industry: string;
  company_size: string;
  years_of_experience: string;
  location_city: string;
  location_country: string;
}

interface HiringData {
  B1: string[];
  B2: string;
  B3: string[];
  B4: string;
  B5: string;
}

interface SkillRating {
  skill_name: string;
  taxonomy_skill_id: string | null;
  importance_rating: number;
  demonstration_rating: number;
  is_custom_skill: boolean;
}

interface GapData {
  D1: string[];
  D2: string;
  D3: string[];
  D4: string;
}

interface TrendsData {
  E1: string[];
  E2: string;
  E3: string;
}

// ==================== COMPONENT ====================

export default function SurveyForm() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeSection, setActiveSection] = useState<SectionKey>("profile");
  const [progress, setProgress] = useState<Record<string, string>>({});
  const [completed, setCompleted] = useState(false);

  // Section data
  const [profile, setProfile] = useState<ProfileData>({
    full_name: "", company_name: "", designation: "", industry: "",
    company_size: "", years_of_experience: "", location_city: "", location_country: "",
  });
  const [hiring, setHiring] = useState<HiringData>({ B1: [], B2: "", B3: [], B4: "", B5: "" });
  const [skillRatings, setSkillRatings] = useState<SkillRating[]>([]);
  const [skillCategories, setSkillCategories] = useState<Record<string, { id: string; name: string }[]>>({});
  const [customSkills, setCustomSkills] = useState<SkillRating[]>([]);
  const [newCustomSkill, setNewCustomSkill] = useState("");
  const [gap, setGap] = useState<GapData>({ D1: [], D2: "", D3: [], D4: "" });
  const [trends, setTrends] = useState<TrendsData>({ E1: [], E2: "", E3: "" });

  // All skill names for E1 selector
  const allSkillNames = [
    ...Object.values(skillCategories).flat().map(s => s.name),
    ...customSkills.map(s => s.skill_name),
  ];

  // ---- Load initial data ----
  useEffect(() => {
    if (!hasSurveyToken()) {
      navigate("/survey");
      return;
    }
    loadInitialData();
  }, [navigate]);

  const loadInitialData = async () => {
    try {
      const [progressData, skills, existingData] = await Promise.all([
        fetchProgress(),
        fetchSkillList(),
        fetchMyResponses(),
      ]);

      setProgress(progressData);
      setSkillCategories(skills);

      // Initialize skill ratings from taxonomy
      const initial: SkillRating[] = [];
      for (const [, categorySkills] of Object.entries(skills)) {
        for (const skill of categorySkills) {
          initial.push({
            skill_name: skill.name,
            taxonomy_skill_id: skill.id,
            importance_rating: 0,
            demonstration_rating: 0,
            is_custom_skill: false,
          });
        }
      }

      // Populate from existing data
      if (existingData.profile) {
        const p = existingData.profile;
        setProfile({
          full_name: p.full_name || "",
          company_name: p.company_name || "",
          designation: p.designation || "",
          industry: p.industry || "",
          company_size: p.company_size || "",
          years_of_experience: p.years_of_experience?.toString() || "",
          location_city: p.location_city || "",
          location_country: p.location_country || "",
        });
      }

      // Populate existing skill ratings
      if (existingData.skill_ratings?.length) {
        const existingMap = new Map<string, any>();
        for (const sr of existingData.skill_ratings) {
          existingMap.set(sr.skill_name, sr);
        }
        for (const rating of initial) {
          const existing = existingMap.get(rating.skill_name);
          if (existing) {
            rating.importance_rating = existing.importance_rating || 0;
            rating.demonstration_rating = existing.demonstration_rating || 0;
          }
        }
        // Add custom skills
        const customs: SkillRating[] = [];
        for (const sr of existingData.skill_ratings) {
          if (sr.is_custom_skill) {
            customs.push({
              skill_name: sr.skill_name,
              taxonomy_skill_id: null,
              importance_rating: sr.importance_rating || 0,
              demonstration_rating: sr.demonstration_rating || 0,
              is_custom_skill: true,
            });
          }
        }
        setCustomSkills(customs);
      }

      setSkillRatings(initial);

      // Populate existing generic responses
      if (existingData.responses?.length) {
        const responseMap = new Map<string, any>();
        for (const r of existingData.responses) {
          responseMap.set(`${r.section_key}:${r.question_key}`, r.response_value);
        }

        // Hiring
        setHiring({
          B1: responseMap.get("hiring_overview:B1")?.selected || [],
          B2: responseMap.get("hiring_overview:B2")?.value || "",
          B3: responseMap.get("hiring_overview:B3")?.ranked || [],
          B4: responseMap.get("hiring_overview:B4")?.value || "",
          B5: responseMap.get("hiring_overview:B5")?.value || "",
        });

        // Gap
        setGap({
          D1: responseMap.get("gap_analysis:D1")?.ranked || [],
          D2: responseMap.get("gap_analysis:D2")?.value || "",
          D3: responseMap.get("gap_analysis:D3")?.selected || [],
          D4: responseMap.get("gap_analysis:D4")?.text || "",
        });

        // Trends
        setTrends({
          E1: responseMap.get("emerging_trends:E1")?.selected || [],
          E2: responseMap.get("emerging_trends:E2")?.value || "",
          E3: responseMap.get("emerging_trends:E3")?.text || "",
        });
      }

      // Jump to first incomplete section
      const sectionOrder: SectionKey[] = ["profile", "hiring_overview", "skill_ratings", "gap_analysis", "emerging_trends"];
      const firstIncomplete = sectionOrder.find(s => progressData[s] !== "complete");
      if (firstIncomplete) {
        setActiveSection(firstIncomplete);
      } else {
        setCompleted(true);
      }
    } catch (err: any) {
      if (err.message === "Session expired") {
        navigate("/survey");
        return;
      }
      toast({ title: "Error loading survey", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // ---- Save handlers ----
  const saveSection = useCallback(async (sectionKey: SectionKey) => {
    setSaving(true);
    try {
      if (sectionKey === "profile") {
        await saveResponses({ section_key: "profile", profile });
      } else if (sectionKey === "hiring_overview") {
        await saveResponses({
          section_key: "hiring_overview",
          responses: [
            { question_key: "B1", response_type: "multi_select", response_value: { selected: hiring.B1 } },
            { question_key: "B2", response_type: "single_select", response_value: { value: hiring.B2 } },
            { question_key: "B3", response_type: "ranking", response_value: { ranked: hiring.B3 } },
            { question_key: "B4", response_type: "single_select", response_value: { value: hiring.B4 } },
            { question_key: "B5", response_type: "text", response_value: { value: hiring.B5 } },
          ],
        });
      } else if (sectionKey === "skill_ratings") {
        const allRatings = [
          ...skillRatings.filter(r => r.importance_rating > 0 || r.demonstration_rating > 0),
          ...customSkills,
        ];
        await saveResponses({ section_key: "skill_ratings", skill_ratings: allRatings });
      } else if (sectionKey === "gap_analysis") {
        await saveResponses({
          section_key: "gap_analysis",
          responses: [
            { question_key: "D1", response_type: "ranking", response_value: { ranked: gap.D1 } },
            { question_key: "D2", response_type: "single_select", response_value: { value: gap.D2 } },
            { question_key: "D3", response_type: "multi_select", response_value: { selected: gap.D3 } },
            { question_key: "D4", response_type: "text", response_value: { text: gap.D4 } },
          ],
        });
      } else if (sectionKey === "emerging_trends") {
        await saveResponses({
          section_key: "emerging_trends",
          responses: [
            { question_key: "E1", response_type: "multi_select", response_value: { selected: trends.E1 } },
            { question_key: "E2", response_type: "single_select", response_value: { value: trends.E2 } },
            { question_key: "E3", response_type: "text", response_value: { text: trends.E3 } },
          ],
        });
      }

      toast({ title: "Saved", description: `Section saved successfully.` });

      // Refresh progress
      const updatedProgress = await fetchProgress();
      setProgress(updatedProgress);

      // Navigate to next section or completion
      const currentIdx = SECTIONS.findIndex(s => s.key === sectionKey);
      if (currentIdx < SECTIONS.length - 1) {
        setActiveSection(SECTIONS[currentIdx + 1].key);
      } else {
        // Check if all complete
        if (updatedProgress.total_pct === 100) {
          setCompleted(true);
        }
      }
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }, [profile, hiring, skillRatings, customSkills, gap, trends, toast]);

  const handleLogout = () => {
    clearSurveyToken();
    navigate("/survey");
  };

  // ---- Multi-select toggle helper ----
  const toggleMultiSelect = (arr: string[], item: string, setter: (v: string[]) => void) => {
    setter(arr.includes(item) ? arr.filter(x => x !== item) : [...arr, item]);
  };

  // ---- Ranking toggle helper (up to N) ----
  const toggleRanking = (arr: string[], item: string, max: number, setter: (v: string[]) => void) => {
    if (arr.includes(item)) {
      setter(arr.filter(x => x !== item));
    } else if (arr.length < max) {
      setter([...arr, item]);
    }
  };

  // ---- Custom skill handler ----
  const addCustomSkill = () => {
    const name = newCustomSkill.trim();
    if (!name) return;
    if (customSkills.length >= 5) {
      toast({ title: "Limit reached", description: "You can add up to 5 custom skills.", variant: "destructive" });
      return;
    }
    if (customSkills.some(s => s.skill_name.toLowerCase() === name.toLowerCase())) {
      toast({ title: "Duplicate", description: "This skill already exists.", variant: "destructive" });
      return;
    }
    setCustomSkills([...customSkills, {
      skill_name: name,
      taxonomy_skill_id: null,
      importance_rating: 0,
      demonstration_rating: 0,
      is_custom_skill: true,
    }]);
    setNewCustomSkill("");
  };

  const removeCustomSkill = (name: string) => {
    setCustomSkills(customSkills.filter(s => s.skill_name !== name));
  };

  const updateSkillRating = (skillName: string, field: "importance_rating" | "demonstration_rating", value: number) => {
    setSkillRatings(prev => prev.map(r =>
      r.skill_name === skillName ? { ...r, [field]: value } : r
    ));
  };

  const updateCustomRating = (skillName: string, field: "importance_rating" | "demonstration_rating", value: number) => {
    setCustomSkills(prev => prev.map(r =>
      r.skill_name === skillName ? { ...r, [field]: value } : r
    ));
  };

  // ---- Loading state ----
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // ---- Completion page ----
  if (completed) {
    return <CompletionPage onLogout={handleLogout} />;
  }

  // ---- Progress calculations ----
  const completedCount = SECTIONS.filter(s => progress[s.key] === "complete").length;
  const progressPct = Number(progress.total_pct) || Math.round((completedCount / SECTIONS.length) * 100);
  const currentIdx = SECTIONS.findIndex(s => s.key === activeSection);

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <div className="border-b bg-card/50 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-sm font-semibold">Nexus Industry Expert Survey</h1>
            <Button variant="ghost" size="sm" className="text-xs" onClick={handleLogout}>
              <LogOut className="h-3 w-3 mr-1" /> Exit
            </Button>
          </div>

          {/* Section tabs */}
          <div className="flex gap-1 mb-3 overflow-x-auto">
            {SECTIONS.map((section) => {
              const Icon = section.icon;
              const status = progress[section.key];
              const isActive = activeSection === section.key;
              return (
                <button
                  key={section.key}
                  onClick={() => setActiveSection(section.key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : status === "complete"
                      ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {section.label}
                  {status === "complete" && <Check className="h-3 w-3" />}
                </button>
              );
            })}
          </div>

          {/* Progress bar */}
          <div className="flex items-center gap-3">
            <Progress value={progressPct} className="flex-1 h-2" />
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {completedCount}/{SECTIONS.length} sections
            </span>
          </div>
        </div>
      </div>

      {/* Section content */}
      <div className="max-w-4xl mx-auto px-4 py-6">
        {activeSection === "profile" && (
          <SectionProfile profile={profile} setProfile={setProfile} />
        )}
        {activeSection === "hiring_overview" && (
          <SectionHiring
            hiring={hiring}
            setHiring={setHiring}
            toggleMultiSelect={toggleMultiSelect}
            toggleRanking={toggleRanking}
          />
        )}
        {activeSection === "skill_ratings" && (
          <SectionSkills
            skillRatings={skillRatings}
            skillCategories={skillCategories}
            customSkills={customSkills}
            newCustomSkill={newCustomSkill}
            setNewCustomSkill={setNewCustomSkill}
            addCustomSkill={addCustomSkill}
            removeCustomSkill={removeCustomSkill}
            updateSkillRating={updateSkillRating}
            updateCustomRating={updateCustomRating}
          />
        )}
        {activeSection === "gap_analysis" && (
          <SectionGap
            gap={gap}
            setGap={setGap}
            toggleRanking={toggleRanking}
            toggleMultiSelect={toggleMultiSelect}
          />
        )}
        {activeSection === "emerging_trends" && (
          <SectionTrends
            trends={trends}
            setTrends={setTrends}
            allSkillNames={allSkillNames}
            toggleMultiSelect={toggleMultiSelect}
          />
        )}

        {/* Navigation buttons */}
        <div className="flex justify-between mt-8 pt-4 border-t">
          <Button
            variant="outline"
            onClick={() => currentIdx > 0 && setActiveSection(SECTIONS[currentIdx - 1].key)}
            disabled={currentIdx === 0}
          >
            <ChevronLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <Button onClick={() => saveSection(activeSection)} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            {currentIdx < SECTIONS.length - 1 ? (
              <>Save & Continue <ChevronRight className="h-4 w-4 ml-1" /></>
            ) : (
              <>Save & Finish <Check className="h-4 w-4 ml-1" /></>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ==================== SECTION COMPONENTS ====================

function SectionProfile({
  profile, setProfile,
}: {
  profile: ProfileData;
  setProfile: (p: ProfileData) => void;
}) {
  const update = (field: keyof ProfileData, value: string) =>
    setProfile({ ...profile, [field]: value });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Section A: Respondent Profile</CardTitle>
        <p className="text-sm text-muted-foreground">Tell us about yourself and your organization.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Full Name *</Label>
            <Input value={profile.full_name} onChange={e => update("full_name", e.target.value)} placeholder="Your full name" />
          </div>
          <div className="space-y-2">
            <Label>Company Name *</Label>
            <Input value={profile.company_name} onChange={e => update("company_name", e.target.value)} placeholder="Company name" />
          </div>
          <div className="space-y-2">
            <Label>Designation / Title *</Label>
            <Input value={profile.designation} onChange={e => update("designation", e.target.value)} placeholder="e.g. VP of HR" />
          </div>
          <div className="space-y-2">
            <Label>Industry *</Label>
            <Select value={profile.industry} onValueChange={v => update("industry", v)}>
              <SelectTrigger><SelectValue placeholder="Select industry" /></SelectTrigger>
              <SelectContent>
                {INDUSTRIES.map(i => <SelectItem key={i} value={i}>{i}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Company Size *</Label>
            <Select value={profile.company_size} onValueChange={v => update("company_size", v)}>
              <SelectTrigger><SelectValue placeholder="Select size" /></SelectTrigger>
              <SelectContent>
                {COMPANY_SIZES.map(s => <SelectItem key={s} value={s}>{s} employees</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Years of Hiring Experience</Label>
            <Input type="number" min="0" max="50" value={profile.years_of_experience} onChange={e => update("years_of_experience", e.target.value)} placeholder="e.g. 10" />
          </div>
          <div className="space-y-2">
            <Label>City</Label>
            <Input value={profile.location_city} onChange={e => update("location_city", e.target.value)} placeholder="e.g. Mumbai" />
          </div>
          <div className="space-y-2">
            <Label>Country</Label>
            <Input value={profile.location_country} onChange={e => update("location_country", e.target.value)} placeholder="e.g. India" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SectionHiring({
  hiring, setHiring, toggleMultiSelect, toggleRanking,
}: {
  hiring: HiringData;
  setHiring: (h: HiringData) => void;
  toggleMultiSelect: (arr: string[], item: string, setter: (v: string[]) => void) => void;
  toggleRanking: (arr: string[], item: string, max: number, setter: (v: string[]) => void) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Section B: Hiring Overview</CardTitle>
        <p className="text-sm text-muted-foreground">Tell us about your MBA hiring patterns.</p>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* B1 */}
        <div className="space-y-3">
          <Label className="text-sm font-medium">B1. What MBA roles do you primarily hire for? <span className="text-muted-foreground font-normal">(Select all that apply)</span></Label>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {MBA_ROLES.map(role => (
              <label key={role} className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={hiring.B1.includes(role)}
                  onCheckedChange={() => toggleMultiSelect(hiring.B1, role, v => setHiring({ ...hiring, B1: v }))}
                />
                {role}
              </label>
            ))}
          </div>
        </div>

        <Separator />

        {/* B2 */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">B2. How many MBA graduates does your org hire per year?</Label>
          <Select value={hiring.B2} onValueChange={v => setHiring({ ...hiring, B2: v })}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Select range" /></SelectTrigger>
            <SelectContent>
              {["0", "1-5", "6-20", "21-50", "50+"].map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <Separator />

        {/* B3 */}
        <div className="space-y-3">
          <Label className="text-sm font-medium">B3. Rank top 3 reasons you reject MBA candidates <span className="text-muted-foreground font-normal">(Click to rank 1-3)</span></Label>
          {hiring.B3.length > 0 && (
            <div className="flex gap-2 flex-wrap mb-2">
              {hiring.B3.map((item, idx) => (
                <Badge key={item} variant="secondary" className="cursor-pointer" onClick={() => toggleRanking(hiring.B3, item, 3, v => setHiring({ ...hiring, B3: v }))}>
                  #{idx + 1} {item} <X className="h-3 w-3 ml-1" />
                </Badge>
              ))}
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {REJECTION_REASONS.map(reason => (
              <label key={reason} className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={hiring.B3.includes(reason)}
                  onCheckedChange={() => toggleRanking(hiring.B3, reason, 3, v => setHiring({ ...hiring, B3: v }))}
                  disabled={hiring.B3.length >= 3 && !hiring.B3.includes(reason)}
                />
                {reason}
              </label>
            ))}
          </div>
        </div>

        <Separator />

        {/* B4 */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">B4. Institution preference?</Label>
          <Select value={hiring.B4} onValueChange={v => setHiring({ ...hiring, B4: v })}>
            <SelectTrigger className="w-64"><SelectValue placeholder="Select preference" /></SelectTrigger>
            <SelectContent>
              {INSTITUTION_PREFS.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <Separator />

        {/* B5 */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">B5. Minimum work experience expected before MBA?</Label>
          <Input
            type="number" min="0" max="20" className="w-32"
            value={hiring.B5}
            onChange={e => setHiring({ ...hiring, B5: e.target.value })}
            placeholder="Years"
          />
        </div>
      </CardContent>
    </Card>
  );
}

function SectionSkills({
  skillRatings, skillCategories, customSkills, newCustomSkill, setNewCustomSkill,
  addCustomSkill, removeCustomSkill, updateSkillRating, updateCustomRating,
}: {
  skillRatings: SkillRating[];
  skillCategories: Record<string, { id: string; name: string }[]>;
  customSkills: SkillRating[];
  newCustomSkill: string;
  setNewCustomSkill: (v: string) => void;
  addCustomSkill: () => void;
  removeCustomSkill: (name: string) => void;
  updateSkillRating: (name: string, field: "importance_rating" | "demonstration_rating", value: number) => void;
  updateCustomRating: (name: string, field: "importance_rating" | "demonstration_rating", value: number) => void;
}) {
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());

  const toggleCategory = (cat: string) => {
    setCollapsedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  };

  // Map from skill name to rating
  const ratingMap = new Map<string, SkillRating>();
  for (const r of skillRatings) ratingMap.set(r.skill_name, r);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Section C: Skill Rating Matrix</CardTitle>
        <p className="text-sm text-muted-foreground">
          Rate each skill on two dimensions: (1) how <strong>important</strong> it is to your organization,
          and (2) how well current MBA candidates <strong>demonstrate</strong> it.
        </p>
        <div className="flex gap-4 text-xs text-muted-foreground mt-2">
          <span>1 = Not important / Very poor</span>
          <span>5 = Critical / Excellent</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {Object.entries(skillCategories).map(([category, skills]) => {
          const isCollapsed = collapsedCategories.has(category);
          return (
            <div key={category}>
              <button
                className="flex items-center gap-2 text-sm font-semibold mb-3 hover:text-primary transition-colors w-full text-left"
                onClick={() => toggleCategory(category)}
              >
                <ChevronRight className={`h-4 w-4 transition-transform ${isCollapsed ? "" : "rotate-90"}`} />
                {category}
                <Badge variant="outline" className="ml-auto text-xs">{skills.length} skills</Badge>
              </button>
              {!isCollapsed && (
                <div className="border rounded-lg overflow-hidden">
                  <div className="grid grid-cols-[1fr_120px_120px] gap-2 px-4 py-2 bg-muted/50 text-xs font-medium text-muted-foreground sticky top-0">
                    <span>Skill</span>
                    <span className="text-center">Importance</span>
                    <span className="text-center">Demonstration</span>
                  </div>
                  {skills.map(skill => {
                    const rating = ratingMap.get(skill.name);
                    return (
                      <div key={skill.id} className="grid grid-cols-[1fr_120px_120px] gap-2 px-4 py-2.5 border-t items-center hover:bg-muted/30">
                        <span className="text-sm">{skill.name}</span>
                        <div className="flex justify-center">
                          <StarRating
                            size="sm"
                            value={rating?.importance_rating || 0}
                            onChange={v => updateSkillRating(skill.name, "importance_rating", v)}
                          />
                        </div>
                        <div className="flex justify-center">
                          <StarRating
                            size="sm"
                            value={rating?.demonstration_rating || 0}
                            onChange={v => updateSkillRating(skill.name, "demonstration_rating", v)}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {/* Custom skills */}
        <div>
          <h3 className="text-sm font-semibold mb-3">Custom Skills</h3>
          {customSkills.length > 0 && (
            <div className="border rounded-lg overflow-hidden mb-3">
              <div className="grid grid-cols-[1fr_120px_120px_32px] gap-2 px-4 py-2 bg-muted/50 text-xs font-medium text-muted-foreground">
                <span>Skill</span>
                <span className="text-center">Importance</span>
                <span className="text-center">Demonstration</span>
                <span></span>
              </div>
              {customSkills.map(skill => (
                <div key={skill.skill_name} className="grid grid-cols-[1fr_120px_120px_32px] gap-2 px-4 py-2.5 border-t items-center">
                  <span className="text-sm">{skill.skill_name}</span>
                  <div className="flex justify-center">
                    <StarRating size="sm" value={skill.importance_rating} onChange={v => updateCustomRating(skill.skill_name, "importance_rating", v)} />
                  </div>
                  <div className="flex justify-center">
                    <StarRating size="sm" value={skill.demonstration_rating} onChange={v => updateCustomRating(skill.skill_name, "demonstration_rating", v)} />
                  </div>
                  <button onClick={() => removeCustomSkill(skill.skill_name)} className="text-muted-foreground hover:text-destructive">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {customSkills.length < 5 && (
            <div className="flex gap-2">
              <Input
                placeholder="Enter a custom skill name"
                value={newCustomSkill}
                onChange={e => setNewCustomSkill(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addCustomSkill()}
                className="max-w-xs"
              />
              <Button variant="outline" size="sm" onClick={addCustomSkill}>
                <Plus className="h-4 w-4 mr-1" /> Add
              </Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-2">You can add up to 5 custom skills ({5 - customSkills.length} remaining)</p>
        </div>
      </CardContent>
    </Card>
  );
}

function SectionGap({
  gap, setGap, toggleRanking, toggleMultiSelect,
}: {
  gap: GapData;
  setGap: (g: GapData) => void;
  toggleRanking: (arr: string[], item: string, max: number, setter: (v: string[]) => void) => void;
  toggleMultiSelect: (arr: string[], item: string, setter: (v: string[]) => void) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Section D: Gap Analysis</CardTitle>
        <p className="text-sm text-muted-foreground">Help us understand the gaps you observe in MBA graduates.</p>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* D1 */}
        <div className="space-y-3">
          <Label className="text-sm font-medium">D1. Rank the top 5 skill gap areas you observe <span className="text-muted-foreground font-normal">(Click to rank 1-5)</span></Label>
          {gap.D1.length > 0 && (
            <div className="flex gap-2 flex-wrap mb-2">
              {gap.D1.map((item, idx) => (
                <Badge key={item} variant="secondary" className="cursor-pointer" onClick={() => toggleRanking(gap.D1, item, 5, v => setGap({ ...gap, D1: v }))}>
                  #{idx + 1} {item} <X className="h-3 w-3 ml-1" />
                </Badge>
              ))}
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {SKILL_GAP_AREAS.map(area => (
              <label key={area} className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={gap.D1.includes(area)}
                  onCheckedChange={() => toggleRanking(gap.D1, area, 5, v => setGap({ ...gap, D1: v }))}
                  disabled={gap.D1.length >= 5 && !gap.D1.includes(area)}
                />
                {area}
              </label>
            ))}
          </div>
        </div>

        <Separator />

        {/* D2 */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">D2. How long until a new MBA hire becomes fully productive?</Label>
          <Select value={gap.D2} onValueChange={v => setGap({ ...gap, D2: v })}>
            <SelectTrigger className="w-64"><SelectValue placeholder="Select time range" /></SelectTrigger>
            <SelectContent>
              {PRODUCTIVITY_OPTIONS.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <Separator />

        {/* D3 */}
        <div className="space-y-3">
          <Label className="text-sm font-medium">D3. What training/support do you provide in the first 6 months? <span className="text-muted-foreground font-normal">(Select all that apply)</span></Label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {TRAINING_OPTIONS.map(opt => (
              <label key={opt} className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={gap.D3.includes(opt)}
                  onCheckedChange={() => toggleMultiSelect(gap.D3, opt, v => setGap({ ...gap, D3: v }))}
                />
                {opt}
              </label>
            ))}
          </div>
        </div>

        <Separator />

        {/* D4 */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">D4. What should MBA programs focus on more to close this gap?</Label>
          <Textarea
            value={gap.D4}
            onChange={e => setGap({ ...gap, D4: e.target.value.slice(0, 500) })}
            placeholder="Share your thoughts on what MBA programs should improve..."
            className="min-h-[100px]"
          />
          <p className="text-xs text-muted-foreground text-right">{gap.D4.length}/500</p>
        </div>
      </CardContent>
    </Card>
  );
}

function SectionTrends({
  trends, setTrends, allSkillNames, toggleMultiSelect,
}: {
  trends: TrendsData;
  setTrends: (t: TrendsData) => void;
  allSkillNames: string[];
  toggleMultiSelect: (arr: string[], item: string, setter: (v: string[]) => void) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Section E: Emerging Trends</CardTitle>
        <p className="text-sm text-muted-foreground">Share your perspective on the future of MBA hiring.</p>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* E1 */}
        <div className="space-y-3">
          <Label className="text-sm font-medium">E1. Which skills are becoming more important in the next 2 years? <span className="text-muted-foreground font-normal">(Select all that apply)</span></Label>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-64 overflow-y-auto border rounded-lg p-3">
            {allSkillNames.map(skill => (
              <label key={skill} className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={trends.E1.includes(skill)}
                  onCheckedChange={() => toggleMultiSelect(trends.E1, skill, v => setTrends({ ...trends, E1: v }))}
                />
                {skill}
              </label>
            ))}
            {allSkillNames.length === 0 && (
              <p className="text-sm text-muted-foreground col-span-3">Complete Section C first to see skill options.</p>
            )}
          </div>
        </div>

        <Separator />

        {/* E2 */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">E2. How is AI/automation impacting the roles you hire for?</Label>
          <Select value={trends.E2} onValueChange={v => setTrends({ ...trends, E2: v })}>
            <SelectTrigger className="w-full max-w-md"><SelectValue placeholder="Select impact level" /></SelectTrigger>
            <SelectContent>
              {AI_IMPACT_OPTIONS.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <Separator />

        {/* E3 */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">E3. What new role types do you expect to create in the next 2 years?</Label>
          <Textarea
            value={trends.E3}
            onChange={e => setTrends({ ...trends, E3: e.target.value.slice(0, 200) })}
            placeholder="e.g. AI Product Manager, Data Ethics Officer..."
            className="min-h-[80px]"
          />
          <p className="text-xs text-muted-foreground text-right">{trends.E3.length}/200</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ==================== COMPLETION PAGE ====================

function CompletionPage({ onLogout }: { onLogout: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-background to-muted/30 p-4">
      <div className="w-full max-w-md text-center space-y-6">
        <div className="flex justify-center">
          <div className="rounded-full bg-green-100 dark:bg-green-900/30 p-4">
            <CheckCircle2 className="h-12 w-12 text-green-600 dark:text-green-400" />
          </div>
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold">Thank You!</h1>
          <p className="text-muted-foreground">
            Your responses have been recorded. Your insights will help shape the future of MBA education and industry alignment.
          </p>
        </div>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              All 5 sections have been completed. Your responses are securely stored and will be used for aggregate analysis only.
            </p>
          </CardContent>
        </Card>
        <Button variant="outline" onClick={onLogout}>
          <LogOut className="h-4 w-4 mr-2" /> Exit Survey
        </Button>
      </div>
    </div>
  );
}

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRoute } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useToast } from "@/hooks/use-toast";
import { StarRating } from "@/components/star-rating";
import {
  Loader2,
  Mail,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  Plus,
  X,
  Eye,
  Check,
  ChevronsUpDown,
} from "lucide-react";
import {
  fetchSurveyMeta,
  sendOtp,
  verifyOtp,
  saveResponses,
  submitSurvey,
  fetchMyResponses,
  fetchSkillList,
  fetchMasterList,
  hasSurveyToken,
  clearSurveyToken,
  type SurveyMeta,
  type SurveySection,
  type SurveyQuestion,
  type ResponseItem,
  type SkillRating,
  type MasterOption,
} from "@/lib/survey-api";

// ============================================================================
// Schema-driven Survey Runtime
// Mounts at /#/s/:slug (standalone, no auth, no sidebar).
// Supports 10 question types: text, long_text, single_choice, multi_choice,
// scale, email, date, skill_matrix, matrix_rating, ranked_list.
// ============================================================================

type AnswerMap = Record<string, Record<string, any>>; // section_key -> question_key -> value

interface RuntimeProps {
  params?: { slug: string };
}

export default function SurveyRuntime(_props: RuntimeProps) {
  const [, params] = useRoute("/s/:slug");
  // wouter on a hash router treats anything after /s/ as the slug, including
  // any "?..." query string appended after the hash (e.g. /#/s/foo?preview=1).
  // Strip the query off the slug param so API calls hit the right endpoint.
  const slug = (params?.slug || "").split("?")[0];
  const { toast } = useToast();

  // Detect ?preview=1 from the URL. Survey runtime sits on the hash-router so
  // the query string lives on window.location.search (Vercel/Vite serve
  // index.html and the hash is appended after); we accept it from either.
  const previewMode = (() => {
    if (typeof window === "undefined") return false;
    const fromSearch = new URLSearchParams(window.location.search).get("preview");
    if (fromSearch === "1" || fromSearch === "true") return true;
    // Hash form: /#/s/<slug>?preview=1
    const hash = window.location.hash || "";
    const qIdx = hash.indexOf("?");
    if (qIdx >= 0) {
      const fromHash = new URLSearchParams(hash.substring(qIdx + 1)).get("preview");
      if (fromHash === "1" || fromHash === "true") return true;
    }
    return false;
  })();

  const [survey, setSurvey] = useState<SurveyMeta | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [authenticated, setAuthenticated] = useState(previewMode); // preview skips OTP
  const [currentSection, setCurrentSection] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [skillRatings, setSkillRatings] = useState<Record<string, SkillRating>>({});
  const [profilePatch, setProfilePatch] = useState<Record<string, any>>({});
  const [savingSection, setSavingSection] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // ---- load survey meta on mount ----
  useEffect(() => {
    if (!slug) return;
    fetchSurveyMeta(slug, { preview: previewMode })
      .then((s) => {
        setSurvey(s);
        if (previewMode) {
          setAuthenticated(true);
        } else if (hasSurveyToken(slug)) {
          setAuthenticated(true);
        }
      })
      .catch((e) => setLoadError(e.message));
  }, [slug, previewMode]);

  // ---- once authenticated, hydrate answers (skipped in preview) ----
  useEffect(() => {
    if (!authenticated || !slug) return;
    if (previewMode) return; // no respondent in preview mode
    fetchMyResponses(slug)
      .then((data) => {
        const map: AnswerMap = {};
        for (const r of data.responses || []) {
          if (!map[r.section_key]) map[r.section_key] = {};
          map[r.section_key][r.question_key] = r.response_value;
        }
        setAnswers(map);
        const sk: Record<string, SkillRating> = {};
        for (const r of data.skill_ratings || []) sk[r.skill_name] = r;
        setSkillRatings(sk);
        if (data.respondent) setProfilePatch(data.respondent);
      })
      .catch(() => {
        // session likely expired
        clearSurveyToken(slug);
        setAuthenticated(false);
      });
  }, [authenticated, slug]);

  // ---- error / loading states ----
  if (loadError) {
    return (
      <CenteredShell>
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle>Survey unavailable</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{loadError}</p>
          </CardContent>
        </Card>
      </CenteredShell>
    );
  }
  if (!survey) {
    return (
      <CenteredShell>
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </CenteredShell>
    );
  }

  if (!authenticated) {
    return <OtpGate slug={slug} survey={survey} onAuthed={() => setAuthenticated(true)} />;
  }

  const isPreview = previewMode || !!survey.preview_mode;

  if (submitted) {
    return <ThankYou survey={survey} />;
  }

  const sections = survey.schema?.sections || [];
  if (sections.length === 0) {
    return (
      <CenteredShell>
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle>{survey.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              This survey has no questions configured yet.
            </p>
          </CardContent>
        </Card>
      </CenteredShell>
    );
  }

  const section = sections[currentSection];
  const totalSections = sections.length;
  const progressPct = Math.round(((currentSection + 1) / totalSections) * 100);

  function setAnswer(secKey: string, qKey: string, value: any) {
    setAnswers((prev) => ({
      ...prev,
      [secKey]: { ...(prev[secKey] || {}), [qKey]: value },
    }));
  }

  function setSkill(name: string, patch: Partial<SkillRating>) {
    setSkillRatings((prev) => ({ ...prev, [name]: { ...(prev[name] || { skill_name: name }), ...patch, skill_name: name } }));
  }

  function removeSkill(name: string) {
    setSkillRatings((prev) => {
      const copy = { ...prev };
      delete copy[name];
      return copy;
    });
  }

  function setProfile(field: string, value: any) {
    setProfilePatch((prev) => ({ ...prev, [field]: value }));
  }

  function validateSection(sec: SurveySection): string | null {
    for (const q of sec.questions || []) {
      if (q.required === false) continue;
      if (q.profile_field) {
        const v = profilePatch[q.profile_field];
        if (v == null || v === "") return `Please answer "${q.label}"`;
        continue;
      }
      if (q.type === "skill_matrix") {
        // Preset mode: every preset row must be rated on both dimensions.
        if (Array.isArray(q.preset_skills) && q.preset_skills.length > 0) {
          for (const name of q.preset_skills) {
            const r = skillRatings[name];
            if (!r || r.importance_rating == null || r.demonstration_rating == null) {
              return `Please rate "${name}" on both Importance and Demonstration`;
            }
          }
          continue;
        }
        // Open mode: rate at least min_skills (default 5).
        const min = q.min_skills ?? 5;
        const count = Object.values(skillRatings).filter(
          (r) => r.importance_rating != null && r.demonstration_rating != null
        ).length;
        if (count < min) return `Please rate at least ${min} skills`;
        continue;
      }
      const v = answers[sec.key]?.[q.key];
      if (q.type === "multi_choice") {
        if (!Array.isArray(v) || v.length === 0) return `Please answer "${q.label}"`;
      } else if (q.type === "master_select") {
        if (q.master_multi) {
          if (!Array.isArray(v) || v.length === 0) return `Please answer "${q.label}"`;
        } else {
          if (!v) return `Please answer "${q.label}"`;
        }
      } else if (q.type === "matrix_rating") {
        const rows = q.rows || [];
        if (!v || typeof v !== "object") return `Please complete "${q.label}"`;
        for (const row of rows) {
          if (v[row.key] == null) return `Please rate "${row.label}" in "${q.label}"`;
        }
      } else if (q.type === "ranked_list") {
        if (!Array.isArray(v) || v.length !== (q.items?.length || 0))
          return `Please rank all items in "${q.label}"`;
      } else {
        if (v == null || v === "") return `Please answer "${q.label}"`;
      }
    }
    return null;
  }

  async function persistSection(sec: SurveySection): Promise<boolean> {
    if (isPreview) return true; // do not write anything from preview mode
    const responses: ResponseItem[] = [];
    const includeSkillRatings: SkillRating[] = [];

    for (const q of sec.questions || []) {
      if (q.profile_field) continue; // sent via profile_patch
      if (q.type === "skill_matrix") continue; // sent via skill_ratings
      const v = answers[sec.key]?.[q.key];
      if (v == null || v === "") continue;
      responses.push({
        question_key: q.key,
        response_type: q.type,
        response_value: v,
      });
    }

    // include skill ratings if this section has a skill_matrix question
    const hasSkillMatrix = (sec.questions || []).some((q) => q.type === "skill_matrix");
    if (hasSkillMatrix) {
      for (const r of Object.values(skillRatings)) {
        if (r.importance_rating != null || r.demonstration_rating != null) {
          includeSkillRatings.push(r);
        }
      }
    }

    // include profile_patch if this section has any profile_field questions
    const hasProfileFields = (sec.questions || []).some((q) => !!q.profile_field);
    const profilePayload: Record<string, any> | undefined = hasProfileFields
      ? Object.fromEntries(
          (sec.questions || [])
            .filter((q) => q.profile_field)
            .map((q) => [q.profile_field as string, profilePatch[q.profile_field as string]])
        )
      : undefined;

    try {
      setSavingSection(true);
      await saveResponses(slug, {
        section_key: sec.key,
        responses,
        skill_ratings: includeSkillRatings.length ? includeSkillRatings : undefined,
        profile_patch: profilePayload,
      });
      return true;
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
      return false;
    } finally {
      setSavingSection(false);
    }
  }

  async function handleNext() {
    const err = validateSection(section);
    if (err) {
      toast({ title: "Required answers missing", description: err, variant: "destructive" });
      return;
    }
    const ok = await persistSection(section);
    if (!ok) return;
    if (currentSection < totalSections - 1) {
      setCurrentSection((i) => i + 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  async function handleSubmit() {
    const err = validateSection(section);
    if (err) {
      toast({ title: "Required answers missing", description: err, variant: "destructive" });
      return;
    }
    if (isPreview) {
      // In preview, simulate submit without hitting the API.
      toast({
        title: "Preview submit",
        description: "Responses are not saved in preview mode.",
      });
      setSubmitted(true);
      return;
    }
    const ok = await persistSection(section);
    if (!ok) return;
    try {
      setSubmitting(true);
      await submitSurvey(slug);
      setSubmitted(true);
    } catch (e: any) {
      toast({ title: "Submit failed", description: e.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  const isLast = currentSection === totalSections - 1;

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      {isPreview && (
        <div className="bg-amber-500 text-amber-950 border-b border-amber-600">
          <div className="max-w-3xl mx-auto px-4 py-2 flex items-center gap-2 text-sm font-medium">
            <Eye className="h-4 w-4 shrink-0" />
            <span>
              Preview mode — this is a draft survey. Your answers will
              <strong> NOT </strong>be saved.
            </span>
          </div>
        </div>
      )}
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="max-w-3xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h1 className="text-lg font-semibold">{survey.title}</h1>
              {survey.audience_type && (
                <Badge variant="secondary" className="mt-1 text-xs capitalize">
                  {survey.audience_type.replace(/_/g, " ")}
                </Badge>
              )}
            </div>
            <span className="text-xs text-muted-foreground">
              Section {currentSection + 1} of {totalSections}
            </span>
          </div>
          <Progress value={progressPct} className="h-2" />
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8">
        <Card>
          <CardHeader>
            <CardTitle>{section.title}</CardTitle>
            {section.description && (
              <p className="text-sm text-muted-foreground mt-2">{section.description}</p>
            )}
          </CardHeader>
          <CardContent className="space-y-8">
            {(section.questions || []).map((q) => (
              <QuestionRenderer
                key={q.key}
                question={q}
                sectionKey={section.key}
                value={
                  q.profile_field
                    ? profilePatch[q.profile_field]
                    : answers[section.key]?.[q.key]
                }
                onChange={(v) => {
                  if (q.profile_field) setProfile(q.profile_field, v);
                  else setAnswer(section.key, q.key, v);
                }}
                skillRatings={skillRatings}
                onSkillChange={setSkill}
                onSkillRemove={removeSkill}
              />
            ))}

            <Separator />

            <div className="flex items-center justify-between">
              <Button
                variant="outline"
                disabled={currentSection === 0}
                onClick={() => {
                  setCurrentSection((i) => Math.max(0, i - 1));
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
              >
                <ChevronLeft className="h-4 w-4 mr-1" /> Back
              </Button>

              {isLast ? (
                <Button onClick={handleSubmit} disabled={savingSection || submitting}>
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Submitting…
                    </>
                  ) : (
                    "Submit"
                  )}
                </Button>
              ) : (
                <Button onClick={handleNext} disabled={savingSection}>
                  {savingSection ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving…
                    </>
                  ) : (
                    <>
                      Next <ChevronRight className="h-4 w-4 ml-1" />
                    </>
                  )}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

// ============================================================================
// OTP gate
// ============================================================================

function OtpGate({
  slug,
  survey,
  onAuthed,
}: {
  slug: string;
  survey: SurveyMeta;
  onAuthed: () => void;
}) {
  const { toast } = useToast();
  const [step, setStep] = useState<"email" | "otp">("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSendOtp(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    try {
      setBusy(true);
      await sendOtp(slug, email);
      setStep("otp");
      toast({ title: "Code sent", description: "Check your email for a 6-digit code." });
    } catch (err: any) {
      toast({ title: "Failed to send code", description: err.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    if (!otp.trim()) return;
    try {
      setBusy(true);
      await verifyOtp(slug, email, otp);
      onAuthed();
    } catch (err: any) {
      toast({ title: "Verification failed", description: err.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <CenteredShell>
      <Card className="max-w-md w-full">
        <CardHeader>
          <CardTitle>{survey.title}</CardTitle>
          {survey.description && (
            <p className="text-sm text-muted-foreground mt-2">{survey.description}</p>
          )}
          {survey.estimated_minutes && (
            <p className="text-xs text-muted-foreground mt-1">
              Estimated time: {survey.estimated_minutes} minutes
            </p>
          )}
        </CardHeader>
        <CardContent>
          {step === "email" ? (
            <form onSubmit={handleSendOtp} className="space-y-4">
              <div>
                <Label htmlFor="email">Your email address</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="mt-1"
                />
                <p className="text-xs text-muted-foreground mt-2">
                  We will email you a 6-digit code to verify and start the survey.
                </p>
              </div>
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Sending…
                  </>
                ) : (
                  <>
                    <Mail className="h-4 w-4 mr-2" /> Send code
                  </>
                )}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <div>
                <Label htmlFor="otp">Enter the 6-digit code sent to {email}</Label>
                <Input
                  id="otp"
                  required
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  placeholder="123456"
                  inputMode="numeric"
                  maxLength={6}
                  className="mt-1 tracking-widest text-lg"
                />
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setStep("email")} disabled={busy}>
                  Change email
                </Button>
                <Button type="submit" className="flex-1" disabled={busy}>
                  {busy ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Verifying…
                    </>
                  ) : (
                    "Verify and start"
                  )}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </CenteredShell>
  );
}

// ============================================================================
// Thank-you screen
// ============================================================================

function ThankYou({ survey }: { survey: SurveyMeta }) {
  return (
    <CenteredShell>
      <Card className="max-w-md w-full text-center">
        <CardHeader>
          <div className="mx-auto h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-2">
            <CheckCircle2 className="h-6 w-6 text-primary" />
          </div>
          <CardTitle>Thank you</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground whitespace-pre-line">
            {survey.thank_you_markdown ||
              "Your responses have been recorded. You can close this tab."}
          </p>
        </CardContent>
      </Card>
    </CenteredShell>
  );
}

function CenteredShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-background to-muted/30 p-4">
      {children}
    </div>
  );
}

// ============================================================================
// Question renderer — dispatches per type
// ============================================================================

function QuestionRenderer({
  question,
  sectionKey,
  value,
  onChange,
  skillRatings,
  onSkillChange,
  onSkillRemove,
}: {
  question: SurveyQuestion;
  sectionKey: string;
  value: any;
  onChange: (v: any) => void;
  skillRatings: Record<string, SkillRating>;
  onSkillChange: (name: string, patch: Partial<SkillRating>) => void;
  onSkillRemove: (name: string) => void;
}) {
  const labelEl = (
    <Label className="text-base font-medium">
      {question.label}
      {question.required !== false && <span className="text-red-500 ml-1">*</span>}
    </Label>
  );

  const descEl = question.description ? (
    <p className="text-sm text-muted-foreground">{question.description}</p>
  ) : null;

  const wrap = (inner: React.ReactNode) => (
    <div className="space-y-2">
      {labelEl}
      {descEl}
      {inner}
    </div>
  );

  switch (question.type) {
    case "text":
    case "email":
      return wrap(
        <Input
          type={question.type === "email" ? "email" : "text"}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={question.type === "email" ? "you@example.com" : ""}
        />
      );

    case "long_text":
      return wrap(
        <Textarea
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          rows={4}
          placeholder=""
        />
      );

    case "date":
      return wrap(
        <Input type="date" value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
      );

    case "single_choice":
      return wrap(
        <RadioGroup value={value ?? ""} onValueChange={onChange} className="space-y-2">
          {(question.options || []).map((opt) => (
            <div key={opt.value} className="flex items-center space-x-2">
              <RadioGroupItem value={opt.value} id={`${sectionKey}-${question.key}-${opt.value}`} />
              <Label
                htmlFor={`${sectionKey}-${question.key}-${opt.value}`}
                className="font-normal cursor-pointer"
              >
                {opt.label}
              </Label>
            </div>
          ))}
        </RadioGroup>
      );

    case "multi_choice": {
      const arr: string[] = Array.isArray(value) ? value : [];
      return wrap(
        <div className="space-y-2">
          {(question.options || []).map((opt) => {
            const checked = arr.includes(opt.value);
            return (
              <div key={opt.value} className="flex items-center space-x-2">
                <Checkbox
                  id={`${sectionKey}-${question.key}-${opt.value}`}
                  checked={checked}
                  onCheckedChange={(c) => {
                    if (c) onChange([...arr, opt.value]);
                    else onChange(arr.filter((v) => v !== opt.value));
                  }}
                />
                <Label
                  htmlFor={`${sectionKey}-${question.key}-${opt.value}`}
                  className="font-normal cursor-pointer"
                >
                  {opt.label}
                </Label>
              </div>
            );
          })}
        </div>
      );
    }

    case "scale": {
      const min = question.scale_min ?? 1;
      const max = question.scale_max ?? 5;
      const range: number[] = [];
      for (let i = min; i <= max; i++) range.push(i);
      return wrap(
        <div>
          <div className="flex flex-wrap gap-2">
            {range.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => onChange(n)}
                className={`h-10 w-10 rounded-md border text-sm font-medium transition ${
                  value === n
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background hover:bg-muted"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          {(question.scale_min_label || question.scale_max_label) && (
            <div className="flex justify-between text-xs text-muted-foreground mt-2">
              <span>{question.scale_min_label}</span>
              <span>{question.scale_max_label}</span>
            </div>
          )}
        </div>
      );
    }

    case "matrix_rating": {
      const rows = question.rows || [];
      const cols = question.cols || [];
      const v = (value && typeof value === "object") ? value : {};
      return wrap(
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="text-left font-medium pb-2"></th>
                {cols.map((c) => (
                  <th key={c.key} className="font-medium text-center pb-2 px-2">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-t">
                  <td className="py-3 pr-3">{row.label}</td>
                  {cols.map((c) => {
                    const checked = v[row.key] === c.key;
                    return (
                      <td key={c.key} className="text-center py-3">
                        <input
                          type="radio"
                          name={`${sectionKey}-${question.key}-${row.key}`}
                          checked={checked}
                          onChange={() => onChange({ ...v, [row.key]: c.key })}
                          className="h-4 w-4 cursor-pointer"
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    case "ranked_list": {
      const items = question.items || [];
      // Default: items in original order
      const order: string[] = Array.isArray(value) && value.length === items.length ? value : items.map((i) => i.key);
      const move = (idx: number, dir: -1 | 1) => {
        const next = [...order];
        const target = idx + dir;
        if (target < 0 || target >= next.length) return;
        [next[idx], next[target]] = [next[target], next[idx]];
        onChange(next);
      };
      const labelOf = (k: string) => items.find((i) => i.key === k)?.label || k;
      return wrap(
        <ol className="space-y-2">
          {order.map((k, idx) => (
            <li
              key={k}
              className="flex items-center justify-between gap-2 rounded-md border bg-background px-3 py-2"
            >
              <span className="flex items-center gap-3">
                <span className="text-xs font-mono text-muted-foreground w-6">#{idx + 1}</span>
                <span>{labelOf(k)}</span>
              </span>
              <span className="flex gap-1">
                <Button type="button" size="icon" variant="ghost" onClick={() => move(idx, -1)} disabled={idx === 0}>
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => move(idx, 1)}
                  disabled={idx === order.length - 1}
                >
                  <ArrowDown className="h-4 w-4" />
                </Button>
              </span>
            </li>
          ))}
        </ol>
      );
    }

    case "skill_matrix":
      return (
        <div className="space-y-3">
          {labelEl}
          {descEl}
          <SkillMatrix
            categories={question.skill_categories}
            ratings={skillRatings}
            onChange={onSkillChange}
            onRemove={onSkillRemove}
            minSkills={question.min_skills ?? 5}
            presetSkills={question.preset_skills}
            allowAddMore={question.allow_add_more}
          />
        </div>
      );

    case "master_select":
      return wrap(
        <MasterSelect
          master={question.master ?? "skills"}
          multi={!!question.master_multi}
          max={question.master_max}
          categories={question.master_categories}
          value={value}
          onChange={onChange}
        />,
      );

    default:
      return wrap(
        <div className="text-sm text-muted-foreground italic">
          Unsupported question type: {(question as any).type}
        </div>
      );
  }
}

// ============================================================================
// Master Select — searchable dropdown sourced from a platform master list
// Supports single (string) and multi (string[]) modes. Skills auto-group by
// taxonomy category. Up to 2000 options come down per type — UI search-filters.
// ============================================================================

function MasterSelect({
  master,
  multi,
  max,
  categories,
  value,
  onChange,
}: {
  master: "skills" | "industries" | "functions" | "families" | "colleges";
  multi: boolean;
  max?: number;
  categories?: string[];
  value: any;
  onChange: (v: any) => void;
}) {
  const [options, setOptions] = useState<MasterOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetchMasterList(master, master === "skills" ? { categories } : undefined)
      .then(setOptions)
      .catch(() => setOptions([]))
      .finally(() => setLoading(false));
  }, [master, JSON.stringify(categories || [])]);

  const byValue = useMemo(() => {
    const m: Record<string, MasterOption> = {};
    for (const o of options) m[o.value] = o;
    return m;
  }, [options]);

  const selectedArr: string[] = multi
    ? Array.isArray(value) ? value : []
    : value ? [value] : [];

  // Pre-filter + group for perf with large lists (skills ~9k, colleges ~1k).
  // Show all options when small; otherwise require a search query and cap matches.
  const LARGE_LIST = options.length > 200;
  const MAX_VISIBLE = 200;
  const [search, setSearch] = useState("");
  const trimmedSearch = search.trim().toLowerCase();

  const visible = useMemo(() => {
    if (!LARGE_LIST) return options;
    if (!trimmedSearch) return null; // null = empty state for large lists
    const out: MasterOption[] = [];
    for (const o of options) {
      if (o.label.toLowerCase().includes(trimmedSearch)) {
        out.push(o);
        if (out.length >= MAX_VISIBLE) break;
      }
    }
    return out;
  }, [options, LARGE_LIST, trimmedSearch]);

  const groups = useMemo(() => {
    const src = visible || [];
    const g: Record<string, MasterOption[]> = {};
    for (const o of src) {
      const key = o.group || "";
      if (!g[key]) g[key] = [];
      g[key].push(o);
    }
    return g;
  }, [visible]);

  const toggle = (val: string) => {
    if (multi) {
      const arr = selectedArr.slice();
      const idx = arr.indexOf(val);
      if (idx >= 0) {
        arr.splice(idx, 1);
      } else {
        if (max && arr.length >= max) return; // capped
        arr.push(val);
      }
      onChange(arr);
    } else {
      onChange(val);
      setOpen(false);
    }
  };

  const removeChip = (val: string) => {
    if (multi) onChange(selectedArr.filter((v) => v !== val));
    else onChange("");
  };

  const triggerLabel = !multi
    ? (value && byValue[value]?.label) || (loading ? "Loading…" : `Select ${master.replace(/s$/, "")}…`)
    : selectedArr.length === 0
      ? loading ? "Loading…" : `Select ${master}…`
      : `${selectedArr.length} selected${max ? ` / ${max}` : ""}`;

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between font-normal"
            disabled={loading}
          >
            <span className="truncate">{triggerLabel}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[--radix-popover-trigger-width] p-0"
          align="start"
        >
          <Command shouldFilter={!LARGE_LIST}>
            <CommandInput
              placeholder={`Search ${master}…`}
              value={search}
              onValueChange={setSearch}
            />
            <CommandList className="max-h-72">
              {LARGE_LIST && visible === null && (
                <div className="px-3 py-3 text-sm text-muted-foreground">
                  Type to search the {options.length} {master} in our catalog.
                </div>
              )}
              {visible && visible.length === 0 && (
                <CommandEmpty>No matches.</CommandEmpty>
              )}
              {visible && visible.length > 0 && Object.entries(groups).map(([groupName, items]) => (
                <CommandGroup key={groupName || "_"} heading={groupName || undefined}>
                  {items.map((opt) => {
                    const checked = selectedArr.includes(opt.value);
                    const disabled =
                      multi && !checked && max != null && selectedArr.length >= max;
                    return (
                      <CommandItem
                        key={opt.value}
                        value={`${opt.label} ${opt.value}`}
                        onSelect={() => !disabled && toggle(opt.value)}
                        className={disabled ? "opacity-40 pointer-events-none" : ""}
                      >
                        <Check
                          className={`mr-2 h-4 w-4 ${checked ? "opacity-100" : "opacity-0"}`}
                        />
                        {opt.label}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ))}
              {LARGE_LIST && visible && visible.length >= MAX_VISIBLE && (
                <div className="px-3 py-2 text-xs text-muted-foreground">
                  Showing first {MAX_VISIBLE}—keep typing to narrow down.
                </div>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {multi && selectedArr.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selectedArr.map((v) => (
            <Badge key={v} variant="secondary" className="pl-2 pr-1 py-1 gap-1">
              {byValue[v]?.label || v}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-4 w-4 ml-1 hover:bg-transparent"
                onClick={() => removeChip(v)}
              >
                <X className="h-3 w-3" />
              </Button>
            </Badge>
          ))}
        </div>
      )}
      {multi && max != null && (
        <p className="text-xs text-muted-foreground">
          {selectedArr.length} of {max} selected
        </p>
      )}
    </div>
  );
}

// ============================================================================
// Skill Matrix — pulls from /api/survey/skill-list, optionally filtered to categories
// Each chosen skill gets two 1–5 ratings: importance and demonstration.
// Custom skills (not in taxonomy) can be added by name.
// ============================================================================

function SkillMatrix({
  categories,
  ratings,
  onChange,
  onRemove,
  minSkills,
  presetSkills,
  allowAddMore,
}: {
  categories?: string[];
  ratings: Record<string, SkillRating>;
  onChange: (name: string, patch: Partial<SkillRating>) => void;
  onRemove: (name: string) => void;
  minSkills: number;
  presetSkills?: string[];
  allowAddMore?: boolean;
}) {
  // Preset mode: a fixed list of skill names is shown as locked rows; respondents
  // can't remove them. The taxonomy picker is hidden unless allowAddMore is true.
  const presetMode = Array.isArray(presetSkills) && presetSkills.length > 0;
  const presetSet = useMemo(
    () => new Set((presetSkills || []).map((s) => s)),
    [presetSkills]
  );
  const showPicker = !presetMode || !!allowAddMore;

  // Seed preset rows once so they render even before the user starts rating.
  useEffect(() => {
    if (!presetMode) return;
    for (const name of presetSkills || []) {
      if (!ratings[name]) {
        // is_preset_skill marks the row as text-only (no taxonomy_skill_id),
        // not as a free-form custom add. Backend treats it like is_custom_skill
        // since there is no taxonomy linkage.
        onChange(name, { skill_name: name, is_custom_skill: true });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetMode, presetSkills?.join("|")]);

  const [list, setList] = useState<Record<string, { id: string; name: string }[]>>({});
  const [loading, setLoading] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchInput, setSearchInput] = useState("");

  useEffect(() => {
    fetchSkillList(categories)
      .then(setList)
      .catch(() => setList({}))
      .finally(() => setLoading(false));
  }, [JSON.stringify(categories || [])]);

  const ratedCount = useMemo(
    () =>
      Object.values(ratings).filter(
        (r) => r.importance_rating != null && r.demonstration_rating != null
      ).length,
    [ratings]
  );

  // Flatten taxonomy with category metadata for searching/grouping inside the popover
  const flatTaxonomy = useMemo(
    () =>
      Object.entries(list).flatMap(([cat, skills]) =>
        skills.map((s) => ({ ...s, category: cat }))
      ),
    [list]
  );

  // Build a lowercased lookup so "already exists" custom-add detection is
  // case-insensitive and matches the catalog.
  const taxonomyByLower = useMemo(() => {
    const m: Record<string, { id: string; name: string; category: string }> = {};
    for (const s of flatTaxonomy) m[s.name.toLowerCase()] = s;
    return m;
  }, [flatTaxonomy]);

  const trimmed = searchInput.trim();
  const trimmedLower = trimmed.toLowerCase();
  const exactCatalogMatch = trimmed ? taxonomyByLower[trimmedLower] : undefined;
  const alreadyRated = trimmed && !!ratings[trimmed];

  // Custom substring filter — the taxonomy is up to ~9k entries; rendering
  // all CommandItems even with cmdk's filter causes a noticeable input lag.
  // We pre-filter to <=200 matches and group them by category before rendering.
  const MAX_RESULTS = 200;
  const filteredByCategory = useMemo(() => {
    if (!trimmedLower) return null; // null = empty state, not zero matches
    const out: Record<string, { id: string; name: string }[]> = {};
    let count = 0;
    for (const s of flatTaxonomy) {
      if (s.name.toLowerCase().includes(trimmedLower)) {
        if (!out[s.category]) out[s.category] = [];
        out[s.category].push({ id: s.id, name: s.name });
        count++;
        if (count >= MAX_RESULTS) break;
      }
    }
    return { groups: out, count };
  }, [flatTaxonomy, trimmedLower]);

  function addFromCatalog(s: { id: string; name: string }) {
    if (!ratings[s.name]) {
      onChange(s.name, { skill_name: s.name, taxonomy_skill_id: s.id });
    }
    setSearchInput("");
    setSearchOpen(false);
  }

  function addCustom(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    // If the typed name happens to match the catalog (case-insensitive),
    // prefer the canonical catalog entry over a custom add.
    const hit = taxonomyByLower[trimmed.toLowerCase()];
    if (hit) return addFromCatalog(hit);
    if (ratings[trimmed]) {
      setSearchInput("");
      setSearchOpen(false);
      return;
    }
    onChange(trimmed, { skill_name: trimmed, is_custom_skill: true });
    setSearchInput("");
    setSearchOpen(false);
  }

  if (loading) {
    return (
      <div className="text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading skill catalog…
      </div>
    );
  }

  // Order rows: locked presets first (in the original preset order), then any
  // additional taxonomy/custom adds in insertion order.
  const orderedRatings = useMemo(() => {
    if (!presetMode) return Object.values(ratings);
    const presetOrdered = (presetSkills || [])
      .map((n) => ratings[n])
      .filter(Boolean) as SkillRating[];
    const extras = Object.values(ratings).filter((r) => !presetSet.has(r.skill_name));
    return [...presetOrdered, ...extras];
  }, [ratings, presetSkills, presetMode, presetSet]);

  return (
    <div className="space-y-4">
      <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
        {presetMode ? (
          <>
            Rate every skill below on both <strong>Importance</strong> (how critical for the role)
            and <strong>Demonstration</strong> (how well candidates typically demonstrate it).
            {allowAddMore ? " You may optionally add more skills from our catalog." : ""}
          </>
        ) : (
          <>
            Rate at least {minSkills} skills on both <strong>Importance</strong> (how critical for
            the role) and <strong>Demonstration</strong> (how well candidates typically demonstrate
            it). Currently rated: <strong>{ratedCount}</strong>
          </>
        )}
      </div>

      {/* Searchable picker — catalog match preferred, custom-add fallback */}
      {showPicker && (
      <Popover open={searchOpen} onOpenChange={setSearchOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={searchOpen}
            className="w-full justify-between font-normal"
          >
            <span className="text-muted-foreground">
              Search and add a skill… <span className="text-xs">({flatTaxonomy.length} in catalog)</span>
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[--radix-popover-trigger-width] p-0"
          align="start"
        >
          <Command
            // We do our own substring filtering for perf with ~9k items;
            // disable cmdk's internal scoring/filter pipeline.
            shouldFilter={false}
          >
            <CommandInput
              placeholder="Type a skill name…"
              value={searchInput}
              onValueChange={setSearchInput}
              onKeyDown={(e) => {
                // Enter on a non-matching custom name => add as custom.
                if (e.key === "Enter" && trimmed && !exactCatalogMatch) {
                  e.preventDefault();
                  addCustom(trimmed);
                }
              }}
            />
            <CommandList className="max-h-72">
              {/* Empty state when nothing typed yet — avoids rendering ~9k rows. */}
              {!trimmed && (
                <div className="px-3 py-3 text-sm text-muted-foreground">
                  Start typing to search the {flatTaxonomy.length} skills in our catalog. If yours
                  isn’t listed, you can add it as a custom skill.
                </div>
              )}
              {filteredByCategory && filteredByCategory.count === 0 && (
                <CommandEmpty>
                  {!alreadyRated ? (
                    <button
                      type="button"
                      onClick={() => addCustom(trimmed)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-muted"
                    >
                      <Plus className="inline h-3.5 w-3.5 mr-1" />
                      Add &ldquo;{trimmed}&rdquo; as custom skill
                    </button>
                  ) : (
                    <div className="px-3 py-2 text-sm text-muted-foreground">
                      &ldquo;{trimmed}&rdquo; is already added below.
                    </div>
                  )}
                </CommandEmpty>
              )}
              {filteredByCategory && filteredByCategory.count > 0 && (
                <>
                  {Object.entries(filteredByCategory.groups).map(([cat, skills]) => (
                    <CommandGroup key={cat} heading={cat}>
                      {skills.map((s) => {
                        const sel = !!ratings[s.name];
                        return (
                          <CommandItem
                            key={s.id}
                            value={s.name}
                            onSelect={() => {
                              if (sel) onRemove(s.name);
                              else addFromCatalog(s);
                            }}
                          >
                            <Check
                              className={`mr-2 h-4 w-4 ${sel ? "opacity-100" : "opacity-0"}`}
                            />
                            {s.name}
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  ))}
                  {filteredByCategory.count >= MAX_RESULTS && (
                    <div className="px-3 py-2 text-xs text-muted-foreground">
                      Showing first {MAX_RESULTS}—keep typing to narrow down.
                    </div>
                  )}
                  {!exactCatalogMatch && !alreadyRated && (
                    <CommandGroup heading="Not in catalog">
                      <CommandItem
                        value={`__custom__${trimmed}`}
                        onSelect={() => addCustom(trimmed)}
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        Add &ldquo;{trimmed}&rdquo; as custom skill
                      </CommandItem>
                    </CommandGroup>
                  )}
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      )}

      {/* Selected skills with rating UI */}
      {orderedRatings.length > 0 && (
        <div className="rounded-md border">
          <div className="grid grid-cols-12 gap-2 px-3 py-2 text-xs font-medium text-muted-foreground border-b bg-muted/30">
            <div className="col-span-5">Skill</div>
            <div className="col-span-3 text-center">Importance</div>
            <div className="col-span-3 text-center">Demonstration</div>
            <div className="col-span-1"></div>
          </div>
          {orderedRatings.map((r) => {
            const isLocked = presetMode && presetSet.has(r.skill_name);
            return (
            <div key={r.skill_name} className="grid grid-cols-12 gap-2 px-3 py-2 items-center border-b last:border-0">
              <div className="col-span-5 text-sm">
                {r.skill_name}
                {!isLocked && r.is_custom_skill && (
                  <Badge variant="outline" className="ml-2 text-[10px]">
                    custom
                  </Badge>
                )}
              </div>
              <div className="col-span-3 flex justify-center">
                <StarRating
                  value={r.importance_rating ?? 0}
                  onChange={(v) => onChange(r.skill_name, { importance_rating: v })}
                  size="sm"
                />
              </div>
              <div className="col-span-3 flex justify-center">
                <StarRating
                  value={r.demonstration_rating ?? 0}
                  onChange={(v) => onChange(r.skill_name, { demonstration_rating: v })}
                  size="sm"
                />
              </div>
              <div className="col-span-1 flex justify-end">
                {!isLocked && (
                  <Button type="button" size="icon" variant="ghost" onClick={() => onRemove(r.skill_name)}>
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

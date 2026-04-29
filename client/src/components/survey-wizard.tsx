import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Sparkles, Upload, FileText, Copy, FileJson } from "lucide-react";
import {
  generateSurvey,
  parseDoc,
  createSurvey,
  listSurveys,
  type AdminSurveyListItem,
  type GeneratedSurveyDraft,
} from "@/lib/admin-survey-api";
import type { SurveySchema } from "@/lib/survey-api";

// Multi-step wizard for the 3 input modes (brief / doc / clone) → preview → save.

type WizardStep = "input" | "preview";
type Mode = "brief" | "doc" | "clone";

const AUDIENCE_OPTIONS: { value: string; label: string }[] = [
  { value: "employer", label: "Employer" },
  { value: "industry_sme", label: "Industry SME" },
  { value: "alumni", label: "Alumni" },
  { value: "faculty", label: "Faculty" },
  { value: "student", label: "Student" },
  { value: "other", label: "Other" },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (surveyId: string) => void;
}

export function SurveyWizard({ open, onOpenChange, onCreated }: Props) {
  const { toast } = useToast();

  // Step state
  const [step, setStep] = useState<WizardStep>("input");
  const [mode, setMode] = useState<Mode>("brief");
  const [audienceType, setAudienceType] = useState("alumni");

  // Input fields
  const [brief, setBrief] = useState("");
  const [docText, setDocText] = useState("");
  const [docFilename, setDocFilename] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Clone source
  const [sourceSurveys, setSourceSurveys] = useState<AdminSurveyListItem[]>([]);
  const [sourceSurveyId, setSourceSurveyId] = useState<string>("");

  // Generation state
  const [generating, setGenerating] = useState(false);
  const [draft, setDraft] = useState<GeneratedSurveyDraft | null>(null);

  // Preview / edit state
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editMinutes, setEditMinutes] = useState<number | "">("");
  const [editSchemaText, setEditSchemaText] = useState("");
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Load clonable surveys when wizard opens
  useEffect(() => {
    if (!open) return;
    listSurveys()
      .then((d) => setSourceSurveys(d.surveys || []))
      .catch(() => setSourceSurveys([]));
  }, [open]);

  // Reset state when dialog closes
  useEffect(() => {
    if (open) return;
    const t = setTimeout(() => {
      setStep("input");
      setMode("brief");
      setBrief("");
      setDocText("");
      setDocFilename(null);
      setSourceSurveyId("");
      setDraft(null);
      setEditTitle("");
      setEditDescription("");
      setEditMinutes("");
      setEditSchemaText("");
      setSchemaError(null);
    }, 200);
    return () => clearTimeout(t);
  }, [open]);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setParsing(true);
    try {
      const { text } = await parseDoc(file);
      setDocText(text);
      setDocFilename(file.name);
      toast({ title: "Document parsed", description: `${text.length.toLocaleString()} characters extracted from ${file.name}` });
    } catch (err: any) {
      toast({ title: "Parse failed", description: err.message, variant: "destructive" });
    } finally {
      setParsing(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleGenerate() {
    setGenerating(true);
    try {
      const payload: any = { mode, audience_type: audienceType };
      if (mode === "brief") payload.brief = brief;
      else if (mode === "doc") payload.doc_text = docText;
      else if (mode === "clone") payload.source_survey_id = sourceSurveyId;

      const result = await generateSurvey(payload);
      setDraft(result);
      setEditTitle(result.suggested_title);
      setEditDescription(result.suggested_description);
      setEditMinutes(result.estimated_minutes ?? "");
      setEditSchemaText(JSON.stringify(result.schema, null, 2));
      setSchemaError(null);
      setStep("preview");
    } catch (err: any) {
      toast({ title: "Generation failed", description: err.message, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  }

  function validateSchema(text: string): SurveySchema | null {
    try {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object") throw new Error("Schema must be an object");
      if (!Array.isArray(parsed.sections) || parsed.sections.length === 0)
        throw new Error("Schema must have at least one section");
      for (const sec of parsed.sections) {
        if (!sec.key || !sec.title || !Array.isArray(sec.questions))
          throw new Error("Each section needs key, title, questions[]");
      }
      setSchemaError(null);
      return parsed;
    } catch (err: any) {
      setSchemaError(err.message);
      return null;
    }
  }

  async function handleSave() {
    const parsed = validateSchema(editSchemaText);
    if (!parsed) {
      toast({ title: "Invalid schema", description: schemaError || "Fix JSON errors before saving", variant: "destructive" });
      return;
    }
    if (!editTitle.trim()) {
      toast({ title: "Title required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const result = await createSurvey({
        title: editTitle.trim(),
        description: editDescription.trim() || undefined,
        audience_type: audienceType,
        schema: parsed,
        estimated_minutes: typeof editMinutes === "number" ? editMinutes : undefined,
      });
      toast({ title: "Survey created", description: `${result.survey.title} (${result.survey.slug})` });
      onOpenChange(false);
      onCreated(result.survey.id);
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const canGenerate = useMemo(() => {
    if (!audienceType) return false;
    if (mode === "brief") return brief.trim().length >= 20;
    if (mode === "doc") return docText.trim().length >= 50;
    if (mode === "clone") return !!sourceSurveyId;
    return false;
  }, [mode, audienceType, brief, docText, sourceSurveyId]);

  // ---- preview helpers ----
  const previewSchema: SurveySchema | null = useMemo(() => {
    try {
      return JSON.parse(editSchemaText);
    } catch {
      return null;
    }
  }, [editSchemaText]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            New survey
          </DialogTitle>
        </DialogHeader>

        {step === "input" ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Audience</Label>
                <Select value={audienceType} onValueChange={setAudienceType}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AUDIENCE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  Who will fill out this survey.
                </p>
              </div>
            </div>

            <div>
              <Label>Input mode</Label>
              <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)} className="mt-2">
                <TabsList className="grid grid-cols-3 w-full">
                  <TabsTrigger value="brief" className="gap-2">
                    <FileText className="h-4 w-4" /> Brief
                  </TabsTrigger>
                  <TabsTrigger value="doc" className="gap-2">
                    <Upload className="h-4 w-4" /> Document
                  </TabsTrigger>
                  <TabsTrigger value="clone" className="gap-2">
                    <Copy className="h-4 w-4" /> Clone
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="brief" className="mt-4">
                  <Label htmlFor="brief">Describe the survey</Label>
                  <Textarea
                    id="brief"
                    value={brief}
                    onChange={(e) => setBrief(e.target.value)}
                    rows={8}
                    placeholder="e.g. A survey for alumni 2-5 years post-graduation to assess how well their MBA prepared them for their current role. Should cover identity (name, current company, designation, industry, years of experience), career trajectory, top 3 skills they use, and a skill matrix rating importance vs demonstration..."
                    className="mt-1"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    The more specific the brief, the better the AI-generated schema. Mention sections, key questions, and any rating scales you want.
                  </p>
                </TabsContent>

                <TabsContent value="doc" className="mt-4">
                  <Label>Upload a document (.docx, .pdf, .txt, .md)</Label>
                  <div className="mt-1 flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={parsing}
                    >
                      {parsing ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Parsing…
                        </>
                      ) : (
                        <>
                          <Upload className="h-4 w-4 mr-2" /> Choose file
                        </>
                      )}
                    </Button>
                    {docFilename && (
                      <Badge variant="secondary" className="gap-1">
                        <FileText className="h-3 w-3" /> {docFilename}
                      </Badge>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".docx,.pdf,.txt,.md"
                      className="hidden"
                      onChange={handleFileChange}
                    />
                  </div>
                  {docText && (
                    <div className="mt-3">
                      <Label className="text-xs text-muted-foreground">
                        Extracted text ({docText.length.toLocaleString()} chars) — edit before generating
                      </Label>
                      <Textarea
                        value={docText}
                        onChange={(e) => setDocText(e.target.value)}
                        rows={10}
                        className="mt-1 font-mono text-xs"
                      />
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="clone" className="mt-4">
                  <Label>Clone from existing survey</Label>
                  <Select value={sourceSurveyId} onValueChange={setSourceSurveyId}>
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select a survey to clone…" />
                    </SelectTrigger>
                    <SelectContent>
                      {sourceSurveys.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          <span className="flex items-center gap-2">
                            <span>{s.title}</span>
                            <Badge variant="outline" className="text-[10px]">
                              {s.audience_type}
                            </Badge>
                            <Badge variant="outline" className="text-[10px]">
                              {s.status}
                            </Badge>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">
                    Cloning copies the source schema as a new draft. The original is unaffected.
                  </p>
                </TabsContent>
              </Tabs>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleGenerate} disabled={!canGenerate || generating}>
                {generating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generating…
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-2" /> Generate schema
                  </>
                )}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2">
                <Label htmlFor="t">Title</Label>
                <Input id="t" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="m">Estimated minutes</Label>
                <Input
                  id="m"
                  type="number"
                  value={editMinutes}
                  onChange={(e) =>
                    setEditMinutes(e.target.value ? parseInt(e.target.value) : "")
                  }
                  className="mt-1"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="d">Description</Label>
              <Textarea id="d" value={editDescription} onChange={(e) => setEditDescription(e.target.value)} rows={2} className="mt-1" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label>Preview</Label>
                  {previewSchema && (
                    <Badge variant="outline" className="text-xs">
                      {previewSchema.sections.length} sections ·{" "}
                      {previewSchema.sections.reduce((acc, s) => acc + (s.questions?.length || 0), 0)} questions
                    </Badge>
                  )}
                </div>
                <div className="border rounded-md bg-muted/30 p-3 max-h-[400px] overflow-y-auto space-y-3 text-sm">
                  {previewSchema ? (
                    previewSchema.sections.map((sec, i) => (
                      <div key={sec.key + i} className="space-y-1">
                        <div className="font-medium">
                          {i + 1}. {sec.title}
                          <span className="text-xs text-muted-foreground ml-2">({sec.key})</span>
                        </div>
                        {sec.description && (
                          <div className="text-xs text-muted-foreground">{sec.description}</div>
                        )}
                        <ul className="ml-4 space-y-1">
                          {(sec.questions || []).map((q) => (
                            <li key={q.key} className="text-xs">
                              <span className="font-mono text-muted-foreground">[{q.type}]</span>{" "}
                              {q.label}
                              {q.required === false && (
                                <span className="text-muted-foreground italic"> · optional</span>
                              )}
                              {q.profile_field && (
                                <Badge variant="outline" className="ml-1 text-[9px]">
                                  profile:{q.profile_field}
                                </Badge>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))
                  ) : (
                    <div className="text-xs text-muted-foreground italic">
                      Schema is invalid — fix JSON to see preview.
                    </div>
                  )}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label className="flex items-center gap-1">
                    <FileJson className="h-4 w-4" /> Schema JSON
                  </Label>
                  {schemaError && (
                    <Badge variant="destructive" className="text-xs">{schemaError}</Badge>
                  )}
                </div>
                <Textarea
                  value={editSchemaText}
                  onChange={(e) => {
                    setEditSchemaText(e.target.value);
                    validateSchema(e.target.value);
                  }}
                  rows={20}
                  className="font-mono text-xs"
                />
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setStep("input")} disabled={saving}>
                Back
              </Button>
              <Button onClick={handleSave} disabled={saving || !!schemaError}>
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Creating…
                  </>
                ) : (
                  "Create as draft"
                )}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  requestOtp, verifyOtp, fetchCollegeInfo, fetchProfile, saveProfile, submitProfile,
  fetchPrograms, saveProgram, deleteProgram,
  setPlaceIntelToken, clearPlaceIntelToken, hasPlaceIntelToken, getStoredCollegeId,
} from "@/lib/placeintel-api";
import {
  Loader2, Mail, KeyRound, Building2, GraduationCap, Calendar, Users,
  BarChart3, Briefcase, Plus, Trash2, Save, Send, CheckCircle2, ChevronLeft, ChevronRight, LogOut,
} from "lucide-react";

// ==================== CONSTANTS ====================

const SECTIONS = [
  { key: "verification", label: "Verification", icon: Mail },
  { key: "placement_cell", label: "Placement Cell", icon: Building2 },
  { key: "programs", label: "Programs", icon: GraduationCap },
  { key: "overall_stats", label: "Overall Stats", icon: BarChart3 },
  { key: "additional", label: "Additional Info", icon: Briefcase },
] as const;

type SectionKey = typeof SECTIONS[number]["key"];

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const PROGRAM_TYPES = ["B.Tech", "MBA", "BBA", "M.Tech", "BCA", "MCA", "B.Com", "M.Com", "B.Sc", "M.Sc", "B.A", "M.A", "BBA+MBA (Integrated)", "Other"];

const SECTORS = ["IT/Software", "BFSI", "Consulting", "FMCG", "Core Engineering", "Healthcare", "E-Commerce", "EdTech", "Manufacturing", "Telecom", "Media", "Government/PSU", "Other"];

const DREAM_POLICIES = ["One offer only", "Dream + Super Dream", "Multiple offers allowed", "No restriction"];

const DESIGNATIONS = ["TPO", "Placement Officer", "Dean", "HOD", "Registrar", "Faculty Coordinator", "Other"];

const BACKLOG_POLICIES = ["No active backlogs", "Max 1 backlog", "Max 2 backlogs", "No backlog policy", "Other"];

// ==================== TYPES ====================

interface CollegeInfo {
  id: string;
  name: string;
  city: string;
  state: string;
  tier: string;
}

interface ProfileData {
  academic_year?: string;
  has_placement_cell?: boolean;
  placement_cell_name?: string;
  placement_cell_head?: string;
  placement_cell_email?: string;
  placement_cell_phone?: string;
  placement_season_start?: string;
  placement_season_end?: string;
  ppt_season_start?: string;
  ppt_season_end?: string;
  internship_drive_start?: string;
  internship_drive_end?: string;
  one_year_internship?: boolean;
  dream_offer_policy?: string;
  min_ctc_expectation?: number | null;
  max_ctc_expectation?: number | null;
  median_ctc_last_year?: number | null;
  highest_ctc_last_year?: number | null;
  overall_placement_rate?: number | null;
  total_students_eligible?: number | null;
  total_students_placed?: number | null;
  total_companies_visited?: number | null;
  top_recruiters?: string[];
  sectors_hiring?: string[];
  selection_process_notes?: string;
  resume_format?: string;
  [key: string]: any;
}

interface ProgramData {
  id?: string;
  program_name: string;
  specialization?: string;
  duration_years?: number | null;
  intake_count?: number | null;
  placement_rate?: number | null;
  students_eligible?: number | null;
  students_placed?: number | null;
  students_opted_higher_studies?: number | null;
  students_entrepreneurship?: number | null;
  min_ctc?: number | null;
  max_ctc?: number | null;
  avg_ctc?: number | null;
  median_ctc?: number | null;
  internship_mandatory?: boolean;
  internship_duration_months?: number | null;
  internship_semester?: string;
  avg_internship_stipend?: number | null;
  internship_conversion_rate?: number | null;
  avg_cgpa?: number | null;
  min_cgpa_for_placement?: number | null;
  backlog_policy?: string;
  dream_offer_policy?: string;
  top_recruiters_for_program?: string[];
  preferred_sectors?: string[];
  [key: string]: any;
}

// ==================== COMPONENT ====================

export default function PlacementForm({ params }: { params: { college_id: string } }) {
  const collegeId = params.college_id;
  const { toast } = useToast();

  // Auth state
  // Allow preview mode for admins (bypass OTP)
  const isPreview = typeof window !== "undefined" && new URLSearchParams(window.location.hash.split("?")[1] || "").get("preview") === "true";
  const [isAuthenticated, setIsAuthenticated] = useState(isPreview || hasPlaceIntelToken());
  const [authEmail, setAuthEmail] = useState("");
  const [authName, setAuthName] = useState("");
  const [authDesignation, setAuthDesignation] = useState("");
  const [authPhone, setAuthPhone] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpValue, setOtpValue] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  // Data state
  const [college, setCollege] = useState<CollegeInfo | null>(null);
  const [profile, setProfile] = useState<ProfileData>({});
  const [programs, setPrograms] = useState<ProgramData[]>([]);
  const [completeness, setCompleteness] = useState(0);
  const [profileStatus, setProfileStatus] = useState("draft");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Section navigation
  const [activeSection, setActiveSection] = useState<SectionKey>("verification");
  const [editingProgramIdx, setEditingProgramIdx] = useState<number | null>(null);

  // Auto-save
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout>>();
  const profileDirty = useRef(false);

  // Tag input state
  const [programRecruiterInput, setProgramRecruiterInput] = useState("");

  // Load college info
  useEffect(() => {
    fetchCollegeInfo(collegeId).then(setCollege).catch(() => {
      toast({ title: "Error", description: "College not found", variant: "destructive" });
    });
  }, [collegeId]);

  // Load profile data when authenticated
  useEffect(() => {
    if (!isAuthenticated) { setLoading(false); return; }
    setLoading(true);
    Promise.all([fetchProfile(collegeId), fetchPrograms(collegeId)])
      .then(([profileData, programsData]) => {
        if (profileData.profile) {
          setProfile(profileData.profile);
          setCompleteness(profileData.profile.completeness_score || 0);
          setProfileStatus(profileData.profile.status || "draft");
          if (profileData.profile.status === "submitted" || profileData.profile.status === "verified") {
            setSubmitted(true);
          }
        }
        setPrograms(programsData || profileData.programs || []);
        setActiveSection("placement_cell");
      })
      .catch((err) => {
        if (err.message === "Session expired") {
          setIsAuthenticated(false);
          toast({ title: "Session expired", description: "Please log in again", variant: "destructive" });
        }
      })
      .finally(() => setLoading(false));
  }, [isAuthenticated, collegeId]);

  // Auto-save every 30 seconds
  useEffect(() => {
    if (!isAuthenticated) return;
    const interval = setInterval(() => {
      if (profileDirty.current) {
        handleSave(true);
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [isAuthenticated, profile]);

  const updateProfile = useCallback((updates: Partial<ProfileData>) => {
    setProfile(prev => ({ ...prev, ...updates }));
    profileDirty.current = true;
  }, []);

  const handleSave = useCallback(async (silent = false) => {
    if (saving) return;
    setSaving(true);
    try {
      const result = await saveProfile(collegeId, profile);
      setCompleteness(result.completeness_score || 0);
      profileDirty.current = false;
      if (!silent) toast({ title: "Saved", description: "Progress saved successfully" });
    } catch (err: any) {
      if (!silent) toast({ title: "Save failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }, [collegeId, profile, saving]);

  const handleSubmit = async () => {
    await handleSave();
    try {
      await submitProfile(collegeId);
      setSubmitted(true);
      setProfileStatus("submitted");
      toast({ title: "Submitted!", description: "Your placement data has been submitted for review." });
    } catch (err: any) {
      toast({ title: "Submit failed", description: err.message, variant: "destructive" });
    }
  };

  const handleSendOtp = async () => {
    if (!authEmail) return;
    setAuthLoading(true);
    try {
      const result = await requestOtp(authEmail, collegeId);
      setOtpSent(true);
      toast({
        title: "OTP Sent",
        description: result.domain_verified
          ? "Verification code sent to your email (domain verified)"
          : "Verification code sent to your email",
      });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setAuthLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otpValue) return;
    setAuthLoading(true);
    try {
      const result = await verifyOtp(authEmail, otpValue);
      setPlaceIntelToken(result.token);
      localStorage.setItem("nexus_placeintel_respondent_id", result.respondent_id);
      localStorage.setItem("nexus_placeintel_college_id", result.college_id);
      setIsAuthenticated(true);
      toast({ title: "Verified!", description: "You can now fill out the placement form." });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    clearPlaceIntelToken();
    setIsAuthenticated(false);
    setProfile({});
    setPrograms([]);
    setActiveSection("verification");
  };

  const handleSaveProgram = async (program: ProgramData) => {
    try {
      const result = await saveProgram(collegeId, program);
      if (program.id) {
        setPrograms(prev => prev.map(p => p.id === program.id ? result : p));
      } else {
        setPrograms(prev => [...prev, result]);
      }
      setEditingProgramIdx(null);
      toast({ title: "Program saved" });
      // Refresh profile for updated completeness
      const profileData = await fetchProfile(collegeId);
      if (profileData.profile) setCompleteness(profileData.profile.completeness_score || 0);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleDeleteProgram = async (programId: string) => {
    try {
      await deleteProgram(programId);
      setPrograms(prev => prev.filter(p => p.id !== programId));
      toast({ title: "Program removed" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };


  // ==================== SUBMITTED STATE ====================
  if (submitted) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white flex items-center justify-center p-4">
        <Card className="max-w-lg w-full text-center">
          <CardContent className="pt-8 pb-8 space-y-4">
            <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto" />
            <h2 className="text-2xl font-bold">Thank You!</h2>
            <p className="text-muted-foreground">
              Your placement data for <strong>{college?.name}</strong> has been submitted for review.
            </p>
            <p className="text-sm text-muted-foreground">
              You can return to this link anytime to update your data.
            </p>
            <Button onClick={() => { setSubmitted(false); setActiveSection("placement_cell"); }}>
              Update Submission
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ==================== AUTH GATE ====================
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="flex items-center justify-center gap-2 mb-2">
              <GraduationCap className="h-8 w-8 text-blue-600" />
              <span className="text-xl font-bold text-blue-600">PlaceIntel</span>
            </div>
            <CardTitle className="text-lg">Campus Placement Intelligence</CardTitle>
            {college && (
              <p className="text-sm text-muted-foreground mt-1">
                {college.name} {college.city ? `— ${college.city}` : ""}
              </p>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {!otpSent ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Enter your official college email to verify your identity and access the placement data form.
                </p>
                <div className="space-y-2">
                  <Label>Email Address</Label>
                  <Input
                    type="email"
                    placeholder="tpo@college.ac.in"
                    value={authEmail}
                    onChange={e => setAuthEmail(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleSendOtp()}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Your Name</Label>
                  <Input placeholder="Full name" value={authName} onChange={e => setAuthName(e.target.value)} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-2">
                    <Label>Designation</Label>
                    <Select value={authDesignation} onValueChange={setAuthDesignation}>
                      <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>
                        {DESIGNATIONS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Phone</Label>
                    <Input placeholder="+91..." value={authPhone} onChange={e => setAuthPhone(e.target.value)} />
                  </div>
                </div>
                <Button className="w-full" onClick={handleSendOtp} disabled={authLoading || !authEmail}>
                  {authLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Mail className="h-4 w-4 mr-2" />}
                  Send Verification Code
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Enter the 6-digit code sent to <strong>{authEmail}</strong>
                </p>
                <div className="space-y-2">
                  <Label>Verification Code</Label>
                  <Input
                    type="text"
                    placeholder="000000"
                    maxLength={6}
                    value={otpValue}
                    onChange={e => setOtpValue(e.target.value.replace(/\D/g, ""))}
                    onKeyDown={e => e.key === "Enter" && handleVerifyOtp()}
                    className="text-center text-2xl tracking-widest"
                  />
                </div>
                <Button className="w-full" onClick={handleVerifyOtp} disabled={authLoading || otpValue.length < 6}>
                  {authLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <KeyRound className="h-4 w-4 mr-2" />}
                  Verify & Continue
                </Button>
                <Button variant="ghost" className="w-full" onClick={() => { setOtpSent(false); setOtpValue(""); }}>
                  Use a different email
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // ==================== LOADING ====================
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  // ==================== MAIN FORM ====================

  const sectionIdx = SECTIONS.findIndex(s => s.key === activeSection);
  const canPrev = sectionIdx > 1; // skip verification section when authenticated
  const canNext = sectionIdx < SECTIONS.length - 1;

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      {/* Preview Banner */}
      {isPreview && (
        <div className="bg-amber-500 text-white text-center py-2 text-sm font-medium">
          Preview Mode — form data will not be saved
        </div>
      )}
      {/* Header */}
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GraduationCap className="h-6 w-6 text-blue-600" />
            <span className="font-bold text-blue-600">PlaceIntel</span>
            {college && <span className="text-sm text-muted-foreground ml-2 hidden sm:inline">— {college.name}</span>}
          </div>
          <div className="flex items-center gap-3">
            <Badge variant={profileStatus === "submitted" ? "default" : "secondary"}>
              {profileStatus === "verified" ? "Verified" : profileStatus === "submitted" ? "Submitted" : "Draft"}
            </Badge>
            <Button variant="ghost" size="sm" onClick={handleLogout}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
        {/* Completeness bar */}
        <div className="max-w-5xl mx-auto px-4 pb-2">
          <div className="flex items-center gap-3">
            <Progress value={completeness} className="h-2 flex-1" />
            <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">{completeness}% complete</span>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6 flex gap-6">
        {/* Section nav - sidebar on desktop, hidden on mobile */}
        <div className="hidden md:block w-56 shrink-0">
          <nav className="space-y-1 sticky top-28">
            {SECTIONS.filter(s => s.key !== "verification").map((s) => {
              const isActive = activeSection === s.key;
              return (
                <button
                  key={s.key}
                  onClick={() => setActiveSection(s.key)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive ? "bg-blue-100 text-blue-700" : "text-muted-foreground hover:bg-gray-100"
                  }`}
                >
                  <s.icon className="h-4 w-4" />
                  {s.label}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Form content */}
        <div className="flex-1 min-w-0 space-y-6">
          {/* Mobile section tabs */}
          <div className="md:hidden flex gap-1 overflow-x-auto pb-2">
            {SECTIONS.filter(s => s.key !== "verification").map((s) => (
              <Button
                key={s.key}
                variant={activeSection === s.key ? "default" : "outline"}
                size="sm"
                onClick={() => setActiveSection(s.key)}
                className="whitespace-nowrap"
              >
                <s.icon className="h-3 w-3 mr-1" />
                {s.label}
              </Button>
            ))}
          </div>

          {/* Section: Placement Cell */}
          {activeSection === "placement_cell" && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="h-5 w-5" />
                  Placement Cell Overview
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Academic Year</Label>
                  <Input
                    placeholder="e.g., 2025-26"
                    value={profile.academic_year || ""}
                    onChange={e => updateProfile({ academic_year: e.target.value })}
                  />
                </div>

                <div className="flex items-center gap-3">
                  <Switch
                    checked={profile.has_placement_cell !== false}
                    onCheckedChange={v => updateProfile({ has_placement_cell: v })}
                  />
                  <Label>Has dedicated placement cell</Label>
                </div>

                <Separator />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Placement Cell Name</Label>
                    <Input
                      placeholder="e.g., Training & Placement Office"
                      value={profile.placement_cell_name || ""}
                      onChange={e => updateProfile({ placement_cell_name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Head of Placement</Label>
                    <Input
                      placeholder="Full name"
                      value={profile.placement_cell_head || ""}
                      onChange={e => updateProfile({ placement_cell_head: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Placement Cell Email</Label>
                    <Input
                      type="email"
                      placeholder="placement@college.ac.in"
                      value={profile.placement_cell_email || ""}
                      onChange={e => updateProfile({ placement_cell_email: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Placement Cell Phone</Label>
                    <Input
                      placeholder="+91..."
                      value={profile.placement_cell_phone || ""}
                      onChange={e => updateProfile({ placement_cell_phone: e.target.value })}
                    />
                  </div>
                </div>

                <Separator />
                <h4 className="font-medium flex items-center gap-2"><Calendar className="h-4 w-4" /> Season Calendar</h4>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Placement Season Start</Label>
                    <Select value={profile.placement_season_start || ""} onValueChange={v => updateProfile({ placement_season_start: v })}>
                      <SelectTrigger><SelectValue placeholder="Select month" /></SelectTrigger>
                      <SelectContent>{MONTHS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Placement Season End</Label>
                    <Select value={profile.placement_season_end || ""} onValueChange={v => updateProfile({ placement_season_end: v })}>
                      <SelectTrigger><SelectValue placeholder="Select month" /></SelectTrigger>
                      <SelectContent>{MONTHS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>PPT Season Start</Label>
                    <Select value={profile.ppt_season_start || ""} onValueChange={v => updateProfile({ ppt_season_start: v })}>
                      <SelectTrigger><SelectValue placeholder="Select month" /></SelectTrigger>
                      <SelectContent>{MONTHS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>PPT Season End</Label>
                    <Select value={profile.ppt_season_end || ""} onValueChange={v => updateProfile({ ppt_season_end: v })}>
                      <SelectTrigger><SelectValue placeholder="Select month" /></SelectTrigger>
                      <SelectContent>{MONTHS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Internship Drive Start</Label>
                    <Select value={profile.internship_drive_start || ""} onValueChange={v => updateProfile({ internship_drive_start: v })}>
                      <SelectTrigger><SelectValue placeholder="Select month" /></SelectTrigger>
                      <SelectContent>{MONTHS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Internship Drive End</Label>
                    <Select value={profile.internship_drive_end || ""} onValueChange={v => updateProfile({ internship_drive_end: v })}>
                      <SelectTrigger><SelectValue placeholder="Select month" /></SelectTrigger>
                      <SelectContent>{MONTHS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Section: Programs */}
          {activeSection === "programs" && (
            <div className="space-y-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <GraduationCap className="h-5 w-5" />
                    Programs ({programs.length})
                  </CardTitle>
                  <Button size="sm" onClick={() => {
                    setPrograms(prev => [...prev, { program_name: "", specialization: "" }]);
                    setEditingProgramIdx(programs.length);
                  }}>
                    <Plus className="h-4 w-4 mr-1" /> Add Program
                  </Button>
                </CardHeader>
                <CardContent>
                  {programs.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      No programs added yet. Click "Add Program" to start.
                    </p>
                  )}
                </CardContent>
              </Card>

              {programs.map((prog, idx) => (
                <Card key={prog.id || idx} className={editingProgramIdx === idx ? "ring-2 ring-blue-300" : ""}>
                  <CardHeader className="flex flex-row items-center justify-between py-3">
                    <CardTitle className="text-base">
                      {prog.program_name || "New Program"}
                      {prog.specialization && ` — ${prog.specialization}`}
                    </CardTitle>
                    <div className="flex gap-1">
                      {editingProgramIdx !== idx && (
                        <Button variant="ghost" size="sm" onClick={() => setEditingProgramIdx(idx)}>Edit</Button>
                      )}
                      {prog.id && (
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={() => handleDeleteProgram(prog.id!)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  {editingProgramIdx === idx && (
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Program Name *</Label>
                          <Select value={prog.program_name} onValueChange={v => {
                            const updated = [...programs];
                            updated[idx] = { ...updated[idx], program_name: v };
                            setPrograms(updated);
                          }}>
                            <SelectTrigger><SelectValue placeholder="Select program" /></SelectTrigger>
                            <SelectContent>{PROGRAM_TYPES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>Specialization</Label>
                          <Input
                            placeholder="e.g., Computer Science"
                            value={prog.specialization || ""}
                            onChange={e => {
                              const updated = [...programs];
                              updated[idx] = { ...updated[idx], specialization: e.target.value };
                              setPrograms(updated);
                            }}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Duration (years)</Label>
                          <Input type="number" step="0.5" value={prog.duration_years ?? ""} onChange={e => {
                            const updated = [...programs];
                            updated[idx] = { ...updated[idx], duration_years: e.target.value ? parseFloat(e.target.value) : null };
                            setPrograms(updated);
                          }} />
                        </div>
                        <div className="space-y-2">
                          <Label>Intake Count (students/batch)</Label>
                          <Input type="number" value={prog.intake_count ?? ""} onChange={e => {
                            const updated = [...programs];
                            updated[idx] = { ...updated[idx], intake_count: e.target.value ? parseInt(e.target.value) : null };
                            setPrograms(updated);
                          }} />
                        </div>
                      </div>

                      <Separator />
                      <h4 className="font-medium text-sm">Placement Stats</h4>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="space-y-2">
                          <Label>Placement Rate (%)</Label>
                          <Input type="number" step="0.1" value={prog.placement_rate ?? ""} onChange={e => {
                            const updated = [...programs];
                            updated[idx] = { ...updated[idx], placement_rate: e.target.value ? parseFloat(e.target.value) : null };
                            setPrograms(updated);
                          }} />
                        </div>
                        <div className="space-y-2">
                          <Label>Students Eligible</Label>
                          <Input type="number" value={prog.students_eligible ?? ""} onChange={e => {
                            const updated = [...programs];
                            updated[idx] = { ...updated[idx], students_eligible: e.target.value ? parseInt(e.target.value) : null };
                            setPrograms(updated);
                          }} />
                        </div>
                        <div className="space-y-2">
                          <Label>Students Placed</Label>
                          <Input type="number" value={prog.students_placed ?? ""} onChange={e => {
                            const updated = [...programs];
                            updated[idx] = { ...updated[idx], students_placed: e.target.value ? parseInt(e.target.value) : null };
                            setPrograms(updated);
                          }} />
                        </div>
                      </div>

                      <h4 className="font-medium text-sm">CTC Data (in INR)</h4>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                        {(["min_ctc", "max_ctc", "avg_ctc", "median_ctc"] as const).map(field => (
                          <div key={field} className="space-y-2">
                            <Label>{field.replace(/_/g, " ").replace("ctc", "CTC").replace(/^\w/, c => c.toUpperCase())}</Label>
                            <Input type="number" value={prog[field] ?? ""} onChange={e => {
                              const updated = [...programs];
                              updated[idx] = { ...updated[idx], [field]: e.target.value ? parseInt(e.target.value) : null };
                              setPrograms(updated);
                            }} />
                          </div>
                        ))}
                      </div>

                      <Separator />
                      <h4 className="font-medium text-sm">Internship</h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="flex items-center gap-3">
                          <Switch checked={prog.internship_mandatory || false} onCheckedChange={v => {
                            const updated = [...programs];
                            updated[idx] = { ...updated[idx], internship_mandatory: v };
                            setPrograms(updated);
                          }} />
                          <Label>Internship Mandatory</Label>
                        </div>
                        <div className="space-y-2">
                          <Label>Duration (months)</Label>
                          <Input type="number" value={prog.internship_duration_months ?? ""} onChange={e => {
                            const updated = [...programs];
                            updated[idx] = { ...updated[idx], internship_duration_months: e.target.value ? parseInt(e.target.value) : null };
                            setPrograms(updated);
                          }} />
                        </div>
                        <div className="space-y-2">
                          <Label>Internship Semester</Label>
                          <Input placeholder="e.g., 6th semester" value={prog.internship_semester || ""} onChange={e => {
                            const updated = [...programs];
                            updated[idx] = { ...updated[idx], internship_semester: e.target.value };
                            setPrograms(updated);
                          }} />
                        </div>
                        <div className="space-y-2">
                          <Label>Avg Stipend (monthly INR)</Label>
                          <Input type="number" value={prog.avg_internship_stipend ?? ""} onChange={e => {
                            const updated = [...programs];
                            updated[idx] = { ...updated[idx], avg_internship_stipend: e.target.value ? parseInt(e.target.value) : null };
                            setPrograms(updated);
                          }} />
                        </div>
                        <div className="space-y-2">
                          <Label>Conversion Rate (%)</Label>
                          <Input type="number" step="0.1" value={prog.internship_conversion_rate ?? ""} onChange={e => {
                            const updated = [...programs];
                            updated[idx] = { ...updated[idx], internship_conversion_rate: e.target.value ? parseFloat(e.target.value) : null };
                            setPrograms(updated);
                          }} />
                        </div>
                      </div>

                      <Separator />
                      <h4 className="font-medium text-sm">Policies</h4>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="space-y-2">
                          <Label>Dream Offer Policy</Label>
                          <Select value={prog.dream_offer_policy || ""} onValueChange={v => {
                            const updated = [...programs];
                            updated[idx] = { ...updated[idx], dream_offer_policy: v };
                            setPrograms(updated);
                          }}>
                            <SelectTrigger><SelectValue placeholder="Select policy" /></SelectTrigger>
                            <SelectContent>{DREAM_POLICIES.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>Backlog Policy</Label>
                          <Select value={prog.backlog_policy || ""} onValueChange={v => {
                            const updated = [...programs];
                            updated[idx] = { ...updated[idx], backlog_policy: v };
                            setPrograms(updated);
                          }}>
                            <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                            <SelectContent>{BACKLOG_POLICIES.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>Min CGPA for Placement</Label>
                          <Input type="number" step="0.01" value={prog.min_cgpa_for_placement ?? ""} onChange={e => {
                            const updated = [...programs];
                            updated[idx] = { ...updated[idx], min_cgpa_for_placement: e.target.value ? parseFloat(e.target.value) : null };
                            setPrograms(updated);
                          }} />
                        </div>
                      </div>

                      <Separator />
                      <h4 className="font-medium text-sm">Student Profile</h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Avg CGPA</Label>
                          <Input type="number" step="0.01" value={prog.avg_cgpa ?? ""} onChange={e => {
                            const updated = [...programs];
                            updated[idx] = { ...updated[idx], avg_cgpa: e.target.value ? parseFloat(e.target.value) : null };
                            setPrograms(updated);
                          }} />
                        </div>
                      </div>

                      <Separator />
                      <h4 className="font-medium text-sm">Top Recruiters</h4>
                      <div className="flex flex-wrap gap-2 mb-2">
                        {(prog.top_recruiters_for_program || []).map(r => (
                          <Badge key={r} variant="secondary" className="gap-1">
                            {r}
                            <button onClick={() => {
                              const updated = [...programs];
                              updated[idx] = { ...updated[idx], top_recruiters_for_program: (prog.top_recruiters_for_program || []).filter(v => v !== r) };
                              setPrograms(updated);
                            }} className="ml-1 hover:text-red-500">x</button>
                          </Badge>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <Input
                          placeholder="Add company name..."
                          value={editingProgramIdx === idx ? programRecruiterInput : ""}
                          onChange={e => setProgramRecruiterInput(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              if (programRecruiterInput.trim()) {
                                const current = prog.top_recruiters_for_program || [];
                                if (!current.includes(programRecruiterInput.trim())) {
                                  const updated = [...programs];
                                  updated[idx] = { ...updated[idx], top_recruiters_for_program: [...current, programRecruiterInput.trim()] };
                                  setPrograms(updated);
                                }
                                setProgramRecruiterInput("");
                              }
                            }
                          }}
                        />
                        <Button variant="outline" size="sm" onClick={() => {
                          if (programRecruiterInput.trim()) {
                            const current = prog.top_recruiters_for_program || [];
                            if (!current.includes(programRecruiterInput.trim())) {
                              const updated = [...programs];
                              updated[idx] = { ...updated[idx], top_recruiters_for_program: [...current, programRecruiterInput.trim()] };
                              setPrograms(updated);
                            }
                            setProgramRecruiterInput("");
                          }
                        }}>Add</Button>
                      </div>

                      <Separator />
                      <h4 className="font-medium text-sm">Preferred Sectors</h4>
                      <div className="flex flex-wrap gap-2">
                        {SECTORS.map(sector => {
                          const selected = (prog.preferred_sectors || []).includes(sector);
                          return (
                            <Badge
                              key={sector}
                              variant={selected ? "default" : "outline"}
                              className="cursor-pointer"
                              onClick={() => {
                                const updated = [...programs];
                                const current = prog.preferred_sectors || [];
                                if (selected) {
                                  updated[idx] = { ...updated[idx], preferred_sectors: current.filter(v => v !== sector) };
                                } else {
                                  updated[idx] = { ...updated[idx], preferred_sectors: [...current, sector] };
                                }
                                setPrograms(updated);
                              }}
                            >
                              {sector}
                            </Badge>
                          );
                        })}
                      </div>

                      <div className="flex justify-end gap-2 pt-2">
                        <Button variant="outline" onClick={() => setEditingProgramIdx(null)}>Cancel</Button>
                        <Button onClick={() => handleSaveProgram(programs[idx])} disabled={!programs[idx].program_name}>
                          <Save className="h-4 w-4 mr-1" /> Save Program
                        </Button>
                      </div>
                    </CardContent>
                  )}
                </Card>
              ))}
            </div>
          )}

          {/* Section: Overall Stats */}
          {activeSection === "overall_stats" && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Overall Placement Statistics
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Aggregate college-level stats. Program-specific policies, recruiters, and sectors are in each program's section.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Total Students Eligible</Label>
                    <Input type="number" value={profile.total_students_eligible ?? ""} onChange={e => updateProfile({ total_students_eligible: e.target.value ? parseInt(e.target.value) : null })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Total Students Placed</Label>
                    <Input type="number" value={profile.total_students_placed ?? ""} onChange={e => updateProfile({ total_students_placed: e.target.value ? parseInt(e.target.value) : null })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Overall Placement Rate (%)</Label>
                    <Input type="number" step="0.1" value={profile.overall_placement_rate ?? ""} onChange={e => updateProfile({ overall_placement_rate: e.target.value ? parseFloat(e.target.value) : null })} />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Total Companies Visited</Label>
                  <Input type="number" value={profile.total_companies_visited ?? ""} onChange={e => updateProfile({ total_companies_visited: e.target.value ? parseInt(e.target.value) : null })} />
                </div>

                <Separator />
                <h4 className="font-medium">CTC Data (Last Year, in INR)</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Highest CTC (Last Year)</Label>
                    <Input type="number" value={profile.highest_ctc_last_year ?? ""} onChange={e => updateProfile({ highest_ctc_last_year: e.target.value ? parseInt(e.target.value) : null })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Median CTC (Last Year)</Label>
                    <Input type="number" value={profile.median_ctc_last_year ?? ""} onChange={e => updateProfile({ median_ctc_last_year: e.target.value ? parseInt(e.target.value) : null })} />
                  </div>
                </div>

                <Separator />
                <div className="space-y-2">
                  <Label>Resume Format</Label>
                  <Select value={profile.resume_format || ""} onValueChange={v => updateProfile({ resume_format: v })}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Standard template provided by college">Standard template provided by college</SelectItem>
                      <SelectItem value="Student's own format">Student's own format</SelectItem>
                      <SelectItem value="Both options available">Both options available</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center gap-3 mt-4">
                  <Switch
                    checked={profile.one_year_internship || false}
                    onCheckedChange={v => updateProfile({ one_year_internship: v })}
                  />
                  <Label>Offers 1-year internship programs</Label>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Section: Additional Info */}
          {activeSection === "additional" && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Briefcase className="h-5 w-5" />
                  Additional Information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Selection Process Notes</Label>
                  <Textarea
                    placeholder="Describe how companies typically hire at your institution (e.g., aptitude test → GD → technical → HR)"
                    value={profile.selection_process_notes || ""}
                    onChange={e => updateProfile({ selection_process_notes: e.target.value })}
                    rows={4}
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Bottom action bar */}
          <div className="flex items-center justify-between pt-4 pb-8">
            <div className="flex gap-2">
              {canPrev && (
                <Button variant="outline" onClick={() => setActiveSection(SECTIONS[sectionIdx - 1].key)}>
                  <ChevronLeft className="h-4 w-4 mr-1" /> Previous
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => handleSave(false)} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                Save
              </Button>
              {canNext ? (
                <Button onClick={() => setActiveSection(SECTIONS[sectionIdx + 1].key)}>
                  Next <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              ) : (
                completeness >= 50 && profileStatus === "draft" && (
                  <Button onClick={handleSubmit}>
                    <Send className="h-4 w-4 mr-1" /> Submit for Review
                  </Button>
                )
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

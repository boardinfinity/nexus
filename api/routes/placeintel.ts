import type { VercelRequest, VercelResponse } from "@vercel/node";
import * as bcrypt from "bcryptjs";
import * as jwt from "jsonwebtoken";
import { AuthResult, requirePermission, requireAdmin } from "../lib/auth";
import { supabase, JWT_SECRET, RESEND_API_KEY } from "../lib/supabase";
import { generateSecureOtp } from "../lib/helpers";

function verifyPlaceIntelJwt(req: VercelRequest): { respondent_id: string; email: string; college_id: string } | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { respondent_id: string; email: string; college_id: string };
    return decoded;
  } catch {
    return null;
  }
}

function calculateCompletenessScore(profile: any, programCount: number): number {
  const fields = [
    profile.academic_year,
    profile.has_placement_cell !== null && profile.has_placement_cell !== undefined,
    profile.placement_cell_head,
    profile.placement_cell_email,
    profile.placement_season_start,
    profile.placement_season_end,
    profile.overall_placement_rate,
    profile.total_students_eligible,
    profile.total_students_placed,
    profile.total_companies_visited,
    profile.median_ctc_last_year,
    profile.highest_ctc_last_year,
    programCount > 0,
    profile.selection_process_notes,
    profile.resume_format,
  ];
  const filled = fields.filter(Boolean).length;
  return Math.round((filled / fields.length) * 1000) / 10;
}

export async function handlePlaceIntelRoutes(path: string, req: VercelRequest, res: VercelResponse): Promise<VercelResponse> {
  // ---- POST /api/placeintel/auth/request-otp ----
  if (path === "/placeintel/auth/request-otp" && req.method === "POST") {
    const { email, college_id } = req.body || {};
    if (!email || !college_id) return res.status(400).json({ error: "Email and college_id are required" });

    const normalizedEmail = email.toLowerCase().trim();

    // Check college exists
    const { data: college } = await supabase.from("colleges").select("id, name, verified_domains").eq("id", college_id).single();
    if (!college) return res.status(404).json({ error: "College not found" });

    // Check domain verification
    const emailDomain = normalizedEmail.split("@")[1];
    const domainVerified = college.verified_domains?.includes(emailDomain) || false;

    const otp = generateSecureOtp(6);
    const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const hashedOtp = await bcrypt.hash(otp, 10);

    // Upsert respondent
    const { error } = await supabase.from("placement_respondents").upsert(
      { college_id, email: normalizedEmail, otp_hash: hashedOtp, otp_expires_at: expires, domain_verified: domainVerified },
      { onConflict: "email" }
    );
    if (error) return res.status(500).json({ error: error.message });

    // Send OTP via Resend
    if (RESEND_API_KEY) {
      try {
        const emailRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: process.env.RESEND_FROM_EMAIL || "Nexus PlaceIntel <onboarding@resend.dev>",
            to: [normalizedEmail],
            subject: `Your PlaceIntel Verification Code — ${college.name}`,
            text: `Your one-time verification code is: ${otp}\n\nValid for 15 minutes.\n\nUse this code to access the placement data form for ${college.name}.`,
          }),
        });
        if (!emailRes.ok) {
          console.error(`[PLACEINTEL OTP] Resend error:`, await emailRes.text());
          console.log(`[PLACEINTEL OTP FALLBACK] Email: ${normalizedEmail}, OTP: ${otp}`);
        }
      } catch (emailErr: any) {
        console.error("[PLACEINTEL OTP] Email send failed:", emailErr.message);
        console.log(`[PLACEINTEL OTP FALLBACK] Email: ${normalizedEmail}, OTP: ${otp}`);
      }
    } else {
      console.log(`[PLACEINTEL OTP] No RESEND_API_KEY. Email: ${normalizedEmail}, OTP: ${otp}`);
    }

    return res.json({ success: true, domain_verified: domainVerified });
  }

  // ---- POST /api/placeintel/auth/verify-otp ----
  if (path === "/placeintel/auth/verify-otp" && req.method === "POST") {
    const { email, otp } = req.body || {};
    if (!email || !otp) return res.status(400).json({ error: "Email and OTP are required" });

    const normalizedEmail = email.toLowerCase().trim();
    const { data: respondent, error } = await supabase
      .from("placement_respondents")
      .select("id, college_id, otp_hash, otp_expires_at")
      .eq("email", normalizedEmail)
      .single();

    if (error || !respondent) return res.status(404).json({ error: "Email not found. Please request a new OTP." });
    if (!respondent.otp_hash || !respondent.otp_expires_at) return res.status(400).json({ error: "No OTP pending. Please request a new one." });
    if (new Date(respondent.otp_expires_at) < new Date()) return res.status(400).json({ error: "OTP has expired. Please request a new one." });

    const isValid = await bcrypt.compare(otp, respondent.otp_hash);
    if (!isValid) return res.status(400).json({ error: "Invalid OTP" });

    // Clear OTP, mark verified
    await supabase.from("placement_respondents").update({
      otp_hash: null,
      otp_expires_at: null,
      is_verified: true,
      last_login_at: new Date().toISOString(),
    }).eq("id", respondent.id);

    const token = jwt.sign(
      { respondent_id: respondent.id, email: normalizedEmail, college_id: respondent.college_id },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.json({ token, respondent_id: respondent.id, college_id: respondent.college_id });
  }

  // ---- GET /api/placeintel/college/:college_id ---- (public — no auth needed, for form header)
  if (path.match(/^\/placeintel\/college\/[^/]+$/) && req.method === "GET") {
    const collegeId = path.split("/")[3];
    const { data: college } = await supabase.from("colleges").select("id, name, city, state, tier").eq("id", collegeId).single();
    if (!college) return res.status(404).json({ error: "College not found" });
    return res.json(college);
  }

  // ---- All routes below require PlaceIntel JWT ----
  const piAuth = verifyPlaceIntelJwt(req);
  if (!piAuth) return res.status(401).json({ error: "PlaceIntel authentication required" });

  // ---- GET /api/placeintel/profile/:college_id ----
  if (path.match(/^\/placeintel\/profile\/[^/]+$/) && req.method === "GET") {
    const collegeId = path.split("/")[3];
    if (piAuth.college_id !== collegeId) {
      return res.status(403).json({ error: "Access denied: college mismatch" });
    }
    const { data: profile } = await supabase.from("placement_profiles").select("*").eq("college_id", collegeId).single();
    const { data: programs } = await supabase.from("placement_programs").select("*").eq("college_id", collegeId).order("program_name");
    return res.json({ profile: profile || null, programs: programs || [] });
  }

  // ---- POST /api/placeintel/profile/:college_id ---- (create/update — auto-save)
  if (path.match(/^\/placeintel\/profile\/[^/]+$/) && req.method === "POST") {
    const collegeId = path.split("/")[3];
    if (piAuth.college_id !== collegeId) {
      return res.status(403).json({ error: "Access denied: college mismatch" });
    }
    const body = req.body || {};

    // Remove fields that shouldn't be set by user
    delete body.id;
    delete body.college_id;
    delete body.status;
    delete body.completeness_score;
    delete body.submitted_at;
    delete body.verified_at;
    delete body.verified_by;

    // Check how many programs exist for completeness
    const { count: programCount } = await supabase.from("placement_programs").select("id", { count: "exact", head: true }).eq("college_id", collegeId);

    const profileData = {
      ...body,
      college_id: collegeId,
      submitted_by: piAuth.respondent_id,
      updated_at: new Date().toISOString(),
    };

    // Calculate completeness
    profileData.completeness_score = calculateCompletenessScore({ ...body }, programCount || 0);

    const { data: existing } = await supabase.from("placement_profiles").select("id").eq("college_id", collegeId).single();

    let result;
    if (existing) {
      const { data, error } = await supabase.from("placement_profiles").update(profileData).eq("college_id", collegeId).select().single();
      if (error) return res.status(500).json({ error: error.message });
      result = data;
    } else {
      profileData.created_at = new Date().toISOString();
      const { data, error } = await supabase.from("placement_profiles").insert(profileData).select().single();
      if (error) return res.status(500).json({ error: error.message });
      result = data;
    }

    return res.json(result);
  }

  // ---- POST /api/placeintel/profile/:college_id/submit ----
  if (path.match(/^\/placeintel\/profile\/[^/]+\/submit$/) && req.method === "POST") {
    const collegeId = path.split("/")[3];
    if (piAuth.college_id !== collegeId) {
      return res.status(403).json({ error: "Access denied: college mismatch" });
    }
    const { data, error } = await supabase.from("placement_profiles").update({
      status: "submitted",
      submitted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("college_id", collegeId).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  // ---- GET /api/placeintel/programs/:college_id ----
  if (path.match(/^\/placeintel\/programs\/[^/]+$/) && req.method === "GET") {
    const collegeId = path.split("/")[3];
    if (piAuth.college_id !== collegeId) {
      return res.status(403).json({ error: "Access denied: college mismatch" });
    }
    const { data, error } = await supabase.from("placement_programs").select("*").eq("college_id", collegeId).order("program_name");
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  }

  // ---- POST /api/placeintel/programs/:college_id ---- (add/update a program)
  if (path.match(/^\/placeintel\/programs\/[^/]+$/) && req.method === "POST") {
    const collegeId = path.split("/")[3];
    if (piAuth.college_id !== collegeId) {
      return res.status(403).json({ error: "Access denied: college mismatch" });
    }
    const body = req.body || {};

    // Ensure profile exists
    let { data: profile } = await supabase.from("placement_profiles").select("id").eq("college_id", collegeId).single();
    if (!profile) {
      const { data: newProfile, error: profileErr } = await supabase.from("placement_profiles").insert({
        college_id: collegeId,
        submitted_by: piAuth.respondent_id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).select("id").single();
      if (profileErr) return res.status(500).json({ error: profileErr.message });
      profile = newProfile;
    }

    const programData = {
      ...body,
      profile_id: profile!.id,
      college_id: collegeId,
      updated_at: new Date().toISOString(),
    };

    if (body.id) {
      // Update existing program
      const programId = body.id;
      delete programData.id;
      const { data, error } = await supabase.from("placement_programs").update(programData).eq("id", programId).select().single();
      if (error) return res.status(500).json({ error: error.message });

      // Recalculate completeness
      const { data: currentProfile } = await supabase.from("placement_profiles").select("*").eq("college_id", collegeId).single();
      const { count: programCount } = await supabase.from("placement_programs").select("id", { count: "exact", head: true }).eq("college_id", collegeId);
      if (currentProfile) {
        const score = calculateCompletenessScore(currentProfile, programCount || 0);
        await supabase.from("placement_profiles").update({ completeness_score: score, updated_at: new Date().toISOString() }).eq("college_id", collegeId);
      }

      return res.json(data);
    } else {
      // Insert new program
      delete programData.id;
      programData.created_at = new Date().toISOString();
      const { data, error } = await supabase.from("placement_programs").insert(programData).select().single();
      if (error) return res.status(500).json({ error: error.message });

      // Recalculate completeness
      const { data: currentProfile } = await supabase.from("placement_profiles").select("*").eq("college_id", collegeId).single();
      const { count: programCount } = await supabase.from("placement_programs").select("id", { count: "exact", head: true }).eq("college_id", collegeId);
      if (currentProfile) {
        const score = calculateCompletenessScore(currentProfile, programCount || 0);
        await supabase.from("placement_profiles").update({ completeness_score: score, updated_at: new Date().toISOString() }).eq("college_id", collegeId);
      }

      return res.json(data);
    }
  }

  // ---- DELETE /api/placeintel/programs/:program_id ----
  if (path.match(/^\/placeintel\/programs\/[^/]+$/) && req.method === "DELETE") {
    const programId = path.split("/")[3];
    // Get college_id before deleting
    const { data: program } = await supabase.from("placement_programs").select("college_id").eq("id", programId).single();
    if (program && piAuth.college_id !== program.college_id) {
      return res.status(403).json({ error: "Access denied: college mismatch" });
    }
    const { error } = await supabase.from("placement_programs").delete().eq("id", programId);
    if (error) return res.status(500).json({ error: error.message });

    // Recalculate completeness
    if (program) {
      const { data: currentProfile } = await supabase.from("placement_profiles").select("*").eq("college_id", program.college_id).single();
      const { count: programCount } = await supabase.from("placement_programs").select("id", { count: "exact", head: true }).eq("college_id", program.college_id);
      if (currentProfile) {
        const score = calculateCompletenessScore(currentProfile, programCount || 0);
        await supabase.from("placement_profiles").update({ completeness_score: score, updated_at: new Date().toISOString() }).eq("college_id", program.college_id);
      }
    }

    return res.json({ success: true });
  }

  return res.status(404).json({ error: "PlaceIntel endpoint not found", path });
}

export async function handlePlaceIntelAdminRoutes(path: string, req: VercelRequest, res: VercelResponse, auth: AuthResult): Promise<VercelResponse | undefined> {
  if (!requireAdmin(auth, res)) return;

  // GET /api/placeintel/admin/colleges — list all colleges with placement status
  if (path === "/placeintel/admin/colleges" && req.method === "GET") {
    const { status: filterStatus, state: filterState, tier: filterTier, search } = req.query as Record<string, string>;

    const { data: colleges, error } = await supabase
      .from("colleges")
      .select("id, name, city, state, tier, priority, nirf_rank, account_type, board_hub_account_id, verified_domains")
      .order("name");
    if (error) return res.status(500).json({ error: error.message });

    // Get all placement profiles and respondents
    const [{ data: profiles }, { data: respondents }] = await Promise.all([
      supabase.from("placement_profiles").select("college_id, status, completeness_score, submitted_at, verified_at, academic_year"),
      supabase.from("placement_respondents").select("college_id, email, name, is_verified"),
    ]);

    const profileMap: Record<string, any> = {};
    for (const p of profiles || []) profileMap[p.college_id] = p;
    const respondentMap: Record<string, any[]> = {};
    for (const r of respondents || []) {
      if (!respondentMap[r.college_id]) respondentMap[r.college_id] = [];
      respondentMap[r.college_id].push(r);
    }

    let result = (colleges || []).map((c: any) => {
      const profile = profileMap[c.id];
      const resps = respondentMap[c.id] || [];
      let placeintel_status = "not_invited";
      if (profile?.status === "verified") placeintel_status = "verified";
      else if (profile?.status === "submitted") placeintel_status = "submitted";
      else if (profile) placeintel_status = "in_progress";
      else if (resps.length > 0) placeintel_status = "invited";
      return {
        ...c,
        placeintel_status,
        completeness_score: profile?.completeness_score || 0,
        submitted_at: profile?.submitted_at,
        verified_at: profile?.verified_at,
        academic_year: profile?.academic_year,
        respondents: resps,
      };
    });

    if (filterStatus) result = result.filter((c: any) => c.placeintel_status === filterStatus);
    if (filterState) result = result.filter((c: any) => c.state === filterState);
    if (filterTier) result = result.filter((c: any) => c.tier === filterTier);
    if (search) {
      const s = search.toLowerCase();
      result = result.filter((c: any) => c.name?.toLowerCase().includes(s) || c.city?.toLowerCase().includes(s));
    }

    return res.json(result);
  }

  // GET /api/placeintel/admin/colleges/:id — full placement data for a college
  if (path.match(/^\/placeintel\/admin\/colleges\/[^/]+$/) && req.method === "GET") {
    const collegeId = path.split("/")[4];
    const [{ data: college }, { data: profile }, { data: programs }, { data: cycles }, { data: respondents }] = await Promise.all([
      supabase.from("colleges").select("*").eq("id", collegeId).single(),
      supabase.from("placement_profiles").select("*").eq("college_id", collegeId).single(),
      supabase.from("placement_programs").select("*").eq("college_id", collegeId).order("program_name"),
      supabase.from("placement_cycles").select("*").eq("college_id", collegeId).order("created_at", { ascending: false }),
      supabase.from("placement_respondents").select("*").eq("college_id", collegeId),
    ]);
    if (!college) return res.status(404).json({ error: "College not found" });
    return res.json({ college, profile, programs: programs || [], cycles: cycles || [], respondents: respondents || [] });
  }

  // POST /api/placeintel/admin/invite — generate invite + create respondent
  if (path === "/placeintel/admin/invite" && req.method === "POST") {
    if (!requirePermission("placeintel", "write")(auth, res)) return;
    const { college_id, email, name } = req.body || {};
    if (!college_id || !email) return res.status(400).json({ error: "college_id and email are required" });

    const normalizedEmail = email.toLowerCase().trim();

    // Check college exists
    const { data: college } = await supabase.from("colleges").select("id, name, verified_domains").eq("id", college_id).single();
    if (!college) return res.status(404).json({ error: "College not found" });

    // Check domain verification
    const emailDomain = normalizedEmail.split("@")[1];
    const domainVerified = college.verified_domains?.includes(emailDomain) || false;

    // Upsert respondent
    const { data: respondent, error } = await supabase.from("placement_respondents").upsert(
      { college_id, email: normalizedEmail, name: name || null, domain_verified: domainVerified },
      { onConflict: "email" }
    ).select("id").single();
    if (error) return res.status(500).json({ error: error.message });

    const inviteLink = `${req.headers.origin || "https://nexus-bi-one.vercel.app"}/#/placement-form/${college_id}`;

    // Send invite email
    if (RESEND_API_KEY) {
      try {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: process.env.RESEND_FROM_EMAIL || "Nexus PlaceIntel <onboarding@resend.dev>",
            to: [normalizedEmail],
            subject: `Placement Data Request — ${college.name}`,
            html: `<p>Hello ${name || ""},</p>
<p>Board Infinity is collecting structured placement data from leading institutions. Please fill out the placement intelligence form for <strong>${college.name}</strong>:</p>
<p><a href="${inviteLink}" style="background:#2563eb;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">Fill Placement Form</a></p>
<p>You will be asked to verify your email via OTP before proceeding.</p>
<p>Thank you,<br/>Board Infinity Team</p>`,
          }),
        });
      } catch (emailErr: any) {
        console.error("[PLACEINTEL INVITE] Email send failed:", emailErr.message);
      }
    }

    return res.json({ success: true, respondent_id: respondent?.id, invite_link: inviteLink, domain_verified: domainVerified });
  }

  // POST /api/placeintel/admin/verify/:college_id — verify a submission
  if (path.match(/^\/placeintel\/admin\/verify\/[^/]+$/) && req.method === "POST") {
    const collegeId = path.split("/")[4];
    const { action: verifyAction } = req.body || {};
    const { data, error } = await supabase.from("placement_profiles").update({
      status: verifyAction === "reject" ? "draft" : "verified",
      verified_at: verifyAction === "reject" ? null : new Date().toISOString(),
      verified_by: auth.email,
    }).eq("college_id", collegeId).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  // GET /api/placeintel/admin/export — export all placement data as CSV
  if (path === "/placeintel/admin/export" && req.method === "GET") {
    const [{ data: colleges }, { data: profiles }, { data: programs }] = await Promise.all([
      supabase.from("colleges").select("id, name, city, state, tier, priority"),
      supabase.from("placement_profiles").select("*"),
      supabase.from("placement_programs").select("*"),
    ]);

    const profileMap: Record<string, any> = {};
    for (const p of profiles || []) profileMap[p.college_id] = p;
    const programMap: Record<string, any[]> = {};
    for (const p of programs || []) {
      if (!programMap[p.college_id]) programMap[p.college_id] = [];
      programMap[p.college_id].push(p);
    }

    const headers = [
      "College Name", "City", "State", "Tier", "Priority", "Status", "Completeness",
      "Academic Year", "Placement Rate", "Total Eligible", "Total Placed",
      "Median CTC", "Highest CTC", "Companies Visited", "Top Recruiters", "Sectors",
      "Programs Count", "Program Details"
    ];
    const rows = (colleges || []).map((c: any) => {
      const p = profileMap[c.id] || {};
      const progs = programMap[c.id] || [];
      return [
        c.name, c.city, c.state, c.tier, c.priority, p.status || "not_invited", p.completeness_score || 0,
        p.academic_year || "", p.overall_placement_rate || "", p.total_students_eligible || "", p.total_students_placed || "",
        p.median_ctc_last_year || "", p.highest_ctc_last_year || "", p.total_companies_visited || "",
        (p.top_recruiters || []).join("; "), (p.sectors_hiring || []).join("; "),
        progs.length,
        progs.map((pr: any) => `${pr.program_name}${pr.specialization ? ` (${pr.specialization})` : ""}: ${pr.placement_rate || "?"}%`).join(" | "),
      ];
    });

    const csvContent = [headers.join(","), ...rows.map(r => r.map((v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=placeintel_export_${new Date().toISOString().split("T")[0]}.csv`);
    return res.send(csvContent);
  }

}

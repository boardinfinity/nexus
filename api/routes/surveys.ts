import type { VercelRequest, VercelResponse } from "@vercel/node";
import * as bcrypt from "bcryptjs";
import * as jwt from "jsonwebtoken";
import { AuthResult, requirePermission, requireAdmin, verifyAuth, hasPermission } from "../lib/auth";
import { supabase, JWT_SECRET } from "../lib/supabase";
import { generateSecureOtp } from "../lib/helpers";
import { sendEmail, basicHtmlTemplate } from "../lib/mailer";
import { callClaude } from "../lib/openai";
import mammoth from "mammoth";
// pdf-parse uses CommonJS-style export; require it lazily to avoid bundling issues.

// ==================== JWT ====================
// Survey JWTs are scoped to a single survey: { survey_id, respondent_id, email }.
// A respondent who participates in multiple surveys gets a separate token per survey.

interface SurveyJwtPayload {
  survey_id: string;
  respondent_id: string;
  email: string;
}

function verifySurveyJwt(req: VercelRequest): SurveyJwtPayload | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.substring(7);
  try {
    return jwt.verify(token, JWT_SECRET) as SurveyJwtPayload;
  } catch {
    return null;
  }
}

function signSurveyJwt(payload: SurveyJwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

// ==================== Helpers ====================

async function loadSurveyBySlug(slug: string) {
  const { data, error } = await supabase
    .from("surveys")
    .select("id, slug, title, description, audience_type, college_id, status, schema, intro_markdown, thank_you_markdown, estimated_minutes, opens_at, closes_at, locked_at, version")
    .eq("slug", slug)
    .single();
  if (error || !data) return null;
  return data;
}

function isOpenForResponses(survey: any): { open: boolean; reason?: string } {
  if (survey.status === "draft") return { open: false, reason: "This survey is not yet published." };
  if (survey.status === "paused") return { open: false, reason: "This survey is currently paused." };
  if (survey.status === "closed" || survey.status === "archived") return { open: false, reason: "This survey is closed." };
  const now = new Date();
  if (survey.opens_at && new Date(survey.opens_at) > now) return { open: false, reason: "This survey has not opened yet." };
  if (survey.closes_at && new Date(survey.closes_at) < now) return { open: false, reason: "This survey has closed." };
  return { open: true };
}

function publicSurveyShape(survey: any, opts?: { preview_mode?: boolean }) {
  return {
    id: survey.id,
    slug: survey.slug,
    title: survey.title,
    description: survey.description,
    audience_type: survey.audience_type,
    schema: survey.schema || { sections: [], settings: {} },
    intro_markdown: survey.intro_markdown,
    thank_you_markdown: survey.thank_you_markdown,
    estimated_minutes: survey.estimated_minutes,
    status: survey.status,
    preview_mode: !!opts?.preview_mode,
  };
}

// Returns true if the authed user is an admin/SPOC who can preview this draft
// (super_admin/admin always; college_rep only if survey is in their scope).
function canPreviewSurvey(auth: AuthResult, survey: any): boolean {
  const u = auth.nexusUser;
  if (!u) return false;
  // Must have read permission on surveys section
  if (!hasPermission(u, "surveys", "read")) return false;
  if (u.role === "super_admin" || u.role === "admin") return true;
  if (u.role === "college_rep") {
    const ids = u.restricted_college_ids || [];
    if (!ids.length) return false; // no scope = no preview
    return ids.includes(survey.college_id || "");
  }
  return false;
}

// ==================== PUBLIC SURVEY ROUTES ====================
// All routes scoped under /api/survey/:slug/... or use slug in body.
// Old /api/survey/auth/send-otp is replaced by /api/survey/:slug/auth/send-otp.

export async function handleSurveyRoutes(path: string, req: VercelRequest, res: VercelResponse): Promise<VercelResponse> {
  // Reserved slugs: paths under /survey/ that are NOT surveys but utility
  // endpoints (catalogs, masters, skill list). The slug catch-all below
  // would otherwise swallow them and reply 404 "Survey not found".
  const RESERVED_SLUGS = new Set(["skill-list", "masters"]);

  // ---- GET /api/survey/:slug ----
  // Public meta + schema (only for surveys that are open for responses).
  // Special case: if ?preview=1 and caller is an authenticated admin/SPOC with
  // scope over this survey, bypass status gating and return preview_mode=true.
  let m = path.match(/^\/survey\/([^/]+)$/);
  if (m && req.method === "GET" && !RESERVED_SLUGS.has(m[1])) {
    const survey = await loadSurveyBySlug(m[1]);
    if (!survey) return res.status(404).json({ error: "Survey not found" });

    const previewRequested = req.query?.preview === "1" || req.query?.preview === "true";
    if (previewRequested) {
      const auth = await verifyAuth(req).catch(() => ({ authenticated: false } as AuthResult));
      if (canPreviewSurvey(auth, survey)) {
        return res.json(publicSurveyShape(survey, { preview_mode: true }));
      }
      // Fall through to normal gating if not authorised
    }

    const open = isOpenForResponses(survey);
    if (!open.open) return res.status(403).json({ error: open.reason });
    return res.json(publicSurveyShape(survey));
  }

  // ---- POST /api/survey/:slug/auth/send-otp ----
  m = path.match(/^\/survey\/([^/]+)\/auth\/send-otp$/);
  if (m && req.method === "POST") {
    const slug = m[1];
    const { email } = req.body || {};
    if (!email || typeof email !== "string") return res.status(400).json({ error: "Email is required" });

    const survey = await loadSurveyBySlug(slug);
    if (!survey) return res.status(404).json({ error: "Survey not found" });
    const open = isOpenForResponses(survey);
    if (!open.open) return res.status(403).json({ error: open.reason });

    const normalizedEmail = email.toLowerCase().trim();
    const otp = generateSecureOtp(6);
    const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const hashedOtp = await bcrypt.hash(otp, 10);

    // Upsert respondent scoped by (survey_id, email)
    // Look up first to decide insert vs update (the unique index is on lower(email)+survey_id)
    const { data: existing } = await supabase
      .from("survey_respondents")
      .select("id")
      .eq("survey_id", survey.id)
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase.from("survey_respondents")
        .update({ auth_otp: hashedOtp, auth_otp_expires: expires })
        .eq("id", existing.id);
      if (error) return res.status(500).json({ error: error.message });
    } else {
      const { error } = await supabase.from("survey_respondents")
        .insert({ survey_id: survey.id, email: normalizedEmail, auth_otp: hashedOtp, auth_otp_expires: expires });
      if (error) return res.status(500).json({ error: error.message });
    }

    // Send OTP via unified mailer
    const otpResult = await sendEmail({
      to: normalizedEmail,
      subject: `Your access code for "${survey.title}"`,
      text: `Your one-time code is: ${otp}\n\nValid for 15 minutes.`,
      html: basicHtmlTemplate({
        title: `Access code for "${survey.title}"`,
        body_html: `<p>Use the code below to verify your email and start the survey.</p><p style="font-size:28px;font-weight:700;letter-spacing:4px;background:#f3f4f6;padding:16px 24px;border-radius:8px;text-align:center;">${otp}</p><p style="color:#6b7280;font-size:13px;">This code is valid for 15 minutes.</p>`,
      }),
      tags: ["nexus-survey", "survey-otp", `slug:${survey.slug}`],
      metadata: { purpose: "survey_otp", survey_id: survey.id, slug: survey.slug, email: normalizedEmail },
    });
    if (!otpResult.ok) {
      console.warn(`[SURVEY OTP] delivery failed slug=${survey.slug} email=${normalizedEmail} provider=${otpResult.provider}: ${otpResult.error}`);
    }

    return res.json({ message: "OTP sent to your email" });
  }

  // ---- POST /api/survey/:slug/auth/verify-otp ----
  m = path.match(/^\/survey\/([^/]+)\/auth\/verify-otp$/);
  if (m && req.method === "POST") {
    const slug = m[1];
    const { email, otp } = req.body || {};
    if (!email || !otp) return res.status(400).json({ error: "Email and OTP are required" });

    const survey = await loadSurveyBySlug(slug);
    if (!survey) return res.status(404).json({ error: "Survey not found" });

    const normalizedEmail = email.toLowerCase().trim();

    const { data: respondent, error } = await supabase
      .from("survey_respondents")
      .select("id, auth_otp, auth_otp_expires")
      .eq("survey_id", survey.id)
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (error || !respondent) return res.status(404).json({ error: "Email not found. Please request a new OTP." });
    if (!respondent.auth_otp || !respondent.auth_otp_expires) {
      return res.status(400).json({ error: "No OTP pending. Please request a new one." });
    }
    if (new Date(respondent.auth_otp_expires) < new Date()) {
      return res.status(400).json({ error: "OTP has expired. Please request a new one." });
    }
    const isValid = await bcrypt.compare(otp, respondent.auth_otp);
    if (!isValid) return res.status(400).json({ error: "Invalid OTP" });

    // Clear OTP and update login time
    await supabase.from("survey_respondents").update({
      auth_otp: null,
      auth_otp_expires: null,
      last_login_at: new Date().toISOString(),
    }).eq("id", respondent.id);

    // Mark invite (if any) as 'started'
    await supabase.from("survey_invites")
      .update({ status: "started" })
      .eq("survey_id", survey.id)
      .eq("email", normalizedEmail)
      .in("status", ["pending", "sent", "opened"]);

    const token = signSurveyJwt({ survey_id: survey.id, respondent_id: respondent.id, email: normalizedEmail });
    return res.json({ token, respondent_id: respondent.id, survey_id: survey.id });
  }

  // ---- GET /api/survey/masters/:type (public, used by master_select questions) ----
  // Returns flat option list [{ value, label, group? }] for use in any dropdown.
  // Supported types: skills, industries, functions, families, colleges.
  // Skills accepts ?categories=cat1,cat2 to filter; result includes group=category.
  m = path.match(/^\/survey\/masters\/([a-z_]+)$/);
  if (m && req.method === "GET") {
    const type = m[1];
    res.setHeader("Cache-Control", "public, max-age=300"); // 5 min CDN cache
    if (type === "skills") {
      const { categories, q: search } = req.query as Record<string, string>;
      // Return the full taxonomy (~9k); UI search-filters client-side.
      let query = supabase
        .from("taxonomy_skills")
        .select("id, name, category")
        .order("category")
        .order("name")
        .limit(10000);
      if (categories) {
        const list = categories.split(",").map((s) => s.trim()).filter(Boolean);
        if (list.length) query = query.in("category", list);
      }
      if (search) query = query.ilike("name", `%${search}%`);
      const { data, error } = await query;
      if (error) return res.status(500).json({ error: error.message });
      return res.json(
        (data || []).map((row: any) => ({ value: row.id, label: row.name, group: row.category || "Other" })),
      );
    }
    if (type === "industries" || type === "functions" || type === "families") {
      const table = type === "industries" ? "job_industries" : type === "functions" ? "job_functions" : "job_families";
      const { data, error } = await supabase.from(table).select("id, name").order("name");
      if (error) return res.status(500).json({ error: error.message });
      return res.json((data || []).map((row: any) => ({ value: row.id, label: row.name })));
    }
    if (type === "colleges") {
      const { q: search } = req.query as Record<string, string>;
      let query = supabase
        .from("colleges")
        .select("id, name, short_name, city, country")
        .order("name")
        .limit(2000);
      if (search) query = query.ilike("name", `%${search}%`);
      const { data, error } = await query;
      if (error) return res.status(500).json({ error: error.message });
      return res.json(
        (data || []).map((row: any) => ({
          value: row.id,
          label: row.short_name ? `${row.name} (${row.short_name})` : row.name,
          group: row.country || undefined,
        })),
      );
    }
    return res.status(404).json({ error: `Unknown master list: ${type}` });
  }

  // ---- GET /api/survey/skill-list (public, used by skill_matrix questions) ----
  // Optionally filter by category list via query param
  if (path === "/survey/skill-list" && req.method === "GET") {
    const { categories } = req.query as Record<string, string>;
    res.setHeader("Cache-Control", "public, max-age=300");
    // Return up to 10k rows so the full taxonomy comes down (~9k skills today).
    let q = supabase.from("taxonomy_skills").select("id, name, category").order("category").order("name").limit(10000);
    if (categories) {
      const list = categories.split(",").map(s => s.trim()).filter(Boolean);
      if (list.length) q = q.in("category", list);
    }
    const { data: skills, error } = await q;
    if (error) return res.status(500).json({ error: error.message });

    const grouped: Record<string, { id: string; name: string }[]> = {};
    for (const skill of skills || []) {
      const cat = skill.category || "Other";
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push({ id: skill.id, name: skill.name });
    }
    return res.json(grouped);
  }

  // ==================== AUTHENTICATED RESPONDENT ROUTES ====================
  const surveyAuth = verifySurveyJwt(req);
  if (!surveyAuth) {
    return res.status(401).json({ error: "Survey authentication required" });
  }

  // ---- GET /api/survey/:slug/progress ----
  m = path.match(/^\/survey\/([^/]+)\/progress$/);
  if (m && req.method === "GET") {
    const slug = m[1];
    const survey = await loadSurveyBySlug(slug);
    if (!survey || survey.id !== surveyAuth.survey_id) {
      return res.status(403).json({ error: "Token does not match this survey" });
    }

    const sections = (survey.schema?.sections || []) as any[];
    const sectionKeys = sections.map(s => s.key);

    const [{ data: responses }, { count: skillCount }] = await Promise.all([
      supabase.from("survey_responses")
        .select("section_key, question_key")
        .eq("respondent_id", surveyAuth.respondent_id)
        .eq("survey_id", survey.id),
      supabase.from("survey_skill_ratings")
        .select("id", { count: "exact", head: true })
        .eq("respondent_id", surveyAuth.respondent_id)
        .eq("survey_id", survey.id),
    ]);

    const sectionResponseCounts: Record<string, Set<string>> = {};
    for (const r of responses || []) {
      if (!sectionResponseCounts[r.section_key]) sectionResponseCounts[r.section_key] = new Set();
      sectionResponseCounts[r.section_key].add(r.question_key);
    }

    const progress: Record<string, string> = {};
    let completed = 0;
    for (const sec of sections) {
      const questions = (sec.questions || []) as any[];
      const requiredQs = questions.filter(q => q.required !== false);
      const requiredKeys = requiredQs.map(q => q.key);
      const containsSkillMatrix = questions.some(q => q.type === "skill_matrix");
      const answered = sectionResponseCounts[sec.key] || new Set();

      let status: "complete" | "in_progress" | "pending" = "pending";
      const requiredAnsweredCount = requiredKeys.filter(k => answered.has(k)).length;
      if (containsSkillMatrix && (skillCount || 0) > 0) {
        status = (skillCount || 0) >= 5 && requiredAnsweredCount === requiredKeys.length ? "complete" : "in_progress";
      } else if (requiredKeys.length === 0) {
        status = answered.size > 0 ? "complete" : "pending";
      } else if (requiredAnsweredCount === requiredKeys.length) {
        status = "complete";
      } else if (requiredAnsweredCount > 0 || answered.size > 0) {
        status = "in_progress";
      }
      progress[sec.key] = status;
      if (status === "complete") completed++;
    }

    return res.json({
      ...progress,
      total_pct: sectionKeys.length ? Math.round((completed / sectionKeys.length) * 100) : 0,
      completed_sections: completed,
      total_sections: sectionKeys.length,
    });
  }

  // ---- POST /api/survey/:slug/responses ----
  // Generic, schema-driven save. Body: { section_key, responses: [{question_key, response_type, response_value}], skill_ratings?: [...] }
  m = path.match(/^\/survey\/([^/]+)\/responses$/);
  if (m && req.method === "POST") {
    const slug = m[1];
    const survey = await loadSurveyBySlug(slug);
    if (!survey || survey.id !== surveyAuth.survey_id) {
      return res.status(403).json({ error: "Token does not match this survey" });
    }
    const open = isOpenForResponses(survey);
    if (!open.open) return res.status(403).json({ error: open.reason });

    const body = req.body || {};
    const { section_key, responses, skill_ratings, profile_patch } = body;

    if (!section_key) return res.status(400).json({ error: "section_key is required" });

    const respondentId = surveyAuth.respondent_id;

    // Optional respondent profile patch (some questions are stored on survey_respondents columns
    // for back-compat: full_name, company_name, designation, industry, company_size,
    // years_of_experience, location_city, location_country)
    if (profile_patch && typeof profile_patch === "object") {
      const allowed = ["full_name", "company_name", "designation", "industry", "company_size", "years_of_experience", "location_city", "location_country"];
      const update: Record<string, any> = {};
      for (const k of allowed) {
        if (k in profile_patch) {
          if (k === "years_of_experience" && profile_patch[k] != null) update[k] = parseInt(profile_patch[k]);
          else update[k] = profile_patch[k] || null;
        }
      }
      if (Object.keys(update).length) {
        await supabase.from("survey_respondents").update(update).eq("id", respondentId);
      }
    }

    // Skill matrix ratings
    if (Array.isArray(skill_ratings)) {
      for (const rating of skill_ratings) {
        if (!rating?.skill_name) continue;
        const { error: rErr } = await supabase.from("survey_skill_ratings").upsert(
          {
            survey_id: survey.id,
            respondent_id: respondentId,
            skill_name: rating.skill_name,
            taxonomy_skill_id: rating.taxonomy_skill_id || null,
            importance_rating: rating.importance_rating ?? null,
            demonstration_rating: rating.demonstration_rating ?? null,
            is_custom_skill: !!rating.is_custom_skill,
          },
          { onConflict: "respondent_id,skill_name" }
        );
        if (rErr) console.error("[SURVEY] skill rating upsert error:", rErr.message);
      }
    }

    // Generic responses
    if (Array.isArray(responses)) {
      for (const item of responses) {
        if (!item?.question_key) continue;
        const { error: qErr } = await supabase.from("survey_responses").upsert(
          {
            survey_id: survey.id,
            respondent_id: respondentId,
            section_key,
            question_key: item.question_key,
            response_type: item.response_type || "unknown",
            response_value: item.response_value ?? null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "respondent_id,section_key,question_key" }
        );
        if (qErr) console.error("[SURVEY] response upsert error:", qErr.message);
      }
    }

    return res.json({ saved: true, section_key, response_count: Array.isArray(responses) ? responses.length : 0, skill_count: Array.isArray(skill_ratings) ? skill_ratings.length : 0 });
  }

  // ---- POST /api/survey/:slug/submit ----
  // Marks the response as final (locks invite to 'completed', sets completed_at on respondent)
  m = path.match(/^\/survey\/([^/]+)\/submit$/);
  if (m && req.method === "POST") {
    const slug = m[1];
    const survey = await loadSurveyBySlug(slug);
    if (!survey || survey.id !== surveyAuth.survey_id) {
      return res.status(403).json({ error: "Token does not match this survey" });
    }

    // Lock the survey on first submission
    if (!survey.locked_at) {
      await supabase.from("surveys").update({ locked_at: new Date().toISOString() }).eq("id", survey.id);
    }

    // Mark invite (if any) as completed
    await supabase.from("survey_invites")
      .update({ status: "completed" })
      .eq("survey_id", survey.id)
      .eq("email", surveyAuth.email);

    return res.json({ submitted: true });
  }

  // ---- GET /api/survey/:slug/my-responses ----
  m = path.match(/^\/survey\/([^/]+)\/my-responses$/);
  if (m && req.method === "GET") {
    const slug = m[1];
    const survey = await loadSurveyBySlug(slug);
    if (!survey || survey.id !== surveyAuth.survey_id) {
      return res.status(403).json({ error: "Token does not match this survey" });
    }

    const [{ data: respondent }, { data: responses }, { data: skillRatings }] = await Promise.all([
      supabase.from("survey_respondents")
        .select("full_name, company_name, designation, industry, company_size, years_of_experience, location_city, location_country")
        .eq("id", surveyAuth.respondent_id).maybeSingle(),
      supabase.from("survey_responses").select("section_key, question_key, response_type, response_value")
        .eq("respondent_id", surveyAuth.respondent_id).eq("survey_id", survey.id),
      supabase.from("survey_skill_ratings").select("skill_name, taxonomy_skill_id, importance_rating, demonstration_rating, is_custom_skill")
        .eq("respondent_id", surveyAuth.respondent_id).eq("survey_id", survey.id),
    ]);

    return res.json({ profile: respondent, responses: responses || [], skill_ratings: skillRatings || [] });
  }

  return res.status(404).json({ error: "Survey endpoint not found", path });
}

// ==================== ADMIN SURVEY ROUTES (post-auth) ====================
// These are used by /survey-admin in the Nexus app. They're scoped to a survey_id and
// support the rebuilt admin UI. The legacy unscoped endpoints are gone.

function determineSurveyStatus(respondent: any, responseSectionKeys: string[], totalSections: number): string {
  const uniqueSections = new Set(responseSectionKeys);
  if (totalSections > 0 && uniqueSections.size >= totalSections) return "completed";
  if (uniqueSections.size > 0) return "started";
  if (respondent.last_login_at) return "registered";
  return "invited";
}

// Apply college-scope filter for college_rep users
function applyCollegeScope(query: any, auth: AuthResult, surveyTable = "surveys") {
  const u = auth.nexusUser;
  if (!u) return query;
  if (u.role === "super_admin" || u.role === "admin") return query;
  if (u.role === "college_rep" && u.restricted_college_ids?.length) {
    return query.in(surveyTable === "surveys" ? "college_id" : "survey_id", u.restricted_college_ids);
  }
  return query;
}

// SPOCs (college_rep) can view + invite only — block create/edit/clone/generate/parse-doc.
function blockCollegeRep(auth: AuthResult, res: VercelResponse, action = "this action"): boolean {
  if (auth.nexusUser?.role === "college_rep") {
    res.status(403).json({ error: `College reps cannot perform ${action}. Contact an admin.` });
    return true;
  }
  return false;
}

// Verify the given survey is in the caller's college scope. Returns the survey row
// on success, or null if it sent a 403/404 response (caller should return).
async function assertSurveyInScope(
  surveyId: string,
  auth: AuthResult,
  res: VercelResponse,
  selectCols = "id, college_id"
): Promise<any | null> {
  const { data, error } = await supabase
    .from("surveys")
    .select(selectCols)
    .eq("id", surveyId)
    .single();
  if (error || !data) {
    res.status(404).json({ error: "Survey not found" });
    return null;
  }
  const survey = data as unknown as { id: string; college_id: string | null };
  const u = auth.nexusUser;
  if (
    u?.role === "college_rep" &&
    u.restricted_college_ids?.length &&
    !u.restricted_college_ids.includes(survey.college_id || "")
  ) {
    res.status(403).json({ error: "Survey not in your scope" });
    return null;
  }
  return survey;
}

export async function handleSurveyAdminRoutes(path: string, req: VercelRequest, res: VercelResponse, auth: AuthResult): Promise<VercelResponse | undefined> {
  if (!auth.nexusUser) return res.status(401).json({ error: "Authentication required" });

  // ---- GET /api/admin/surveys (list all surveys, college-scoped for SPOCs) ----
  if (path === "/admin/surveys" && req.method === "GET") {
    if (!requirePermission("surveys", "read")(auth, res)) return;
    const { status: statusFilter, audience, college_id } = req.query as Record<string, string>;

    let q = supabase.from("surveys").select("id, slug, title, description, audience_type, college_id, status, version, locked_at, opens_at, closes_at, created_by, created_at, updated_at, schema").order("created_at", { ascending: false });
    if (statusFilter && statusFilter !== "all") q = q.eq("status", statusFilter);
    if (audience) q = q.eq("audience_type", audience);
    if (college_id) q = q.eq("college_id", college_id);
    q = applyCollegeScope(q, auth);

    const { data: surveys, error } = await q;
    if (error) return res.status(500).json({ error: error.message });

    // Augment with respondent counts in one query
    const surveyIds = (surveys || []).map(s => s.id);
    let countsBySurvey: Record<string, { respondents: number; completed: number }> = {};
    if (surveyIds.length) {
      const { data: respCounts } = await supabase
        .from("survey_respondents")
        .select("survey_id, last_login_at")
        .in("survey_id", surveyIds);
      for (const r of respCounts || []) {
        if (!countsBySurvey[r.survey_id]) countsBySurvey[r.survey_id] = { respondents: 0, completed: 0 };
        countsBySurvey[r.survey_id].respondents++;
        if (r.last_login_at) countsBySurvey[r.survey_id].completed++;
      }
    }

    return res.json({
      surveys: (surveys || []).map((s: any) => ({
        ...s,
        section_count: (s.schema?.sections || []).length,
        question_count: (s.schema?.sections || []).reduce((sum: number, sec: any) => sum + ((sec.questions || []).length), 0),
        respondent_count: countsBySurvey[s.id]?.respondents || 0,
        completed_count: countsBySurvey[s.id]?.completed || 0,
        // strip schema from list payload (not needed)
        schema: undefined,
      })),
    });
  }

  // ---- POST /api/admin/surveys (create a new survey) ----
  if (path === "/admin/surveys" && req.method === "POST") {
    if (!requirePermission("surveys", "write")(auth, res)) return;
    if (blockCollegeRep(auth, res, "survey creation")) return;
    const { title, slug, description, audience_type, college_id, schema, intro_markdown, thank_you_markdown, estimated_minutes } = req.body || {};

    if (!title || !audience_type) return res.status(400).json({ error: "title and audience_type are required" });

    const finalSlug = (slug && typeof slug === "string" ? slug : title)
      .toString().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80) + "-" + Math.random().toString(36).slice(2, 6);

    const { data, error } = await supabase.from("surveys").insert({
      slug: finalSlug,
      title,
      description: description || null,
      audience_type,
      college_id: college_id || null,
      schema: schema || { sections: [], settings: {} },
      intro_markdown: intro_markdown || null,
      thank_you_markdown: thank_you_markdown || null,
      estimated_minutes: estimated_minutes || null,
      created_by: auth.nexusUser.id,
      status: "draft",
    }).select().single();

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ survey: data });
  }

  // ---- GET /api/admin/surveys/:id ----
  let m = path.match(/^\/admin\/surveys\/([^/]+)$/);
  if (m && req.method === "GET") {
    if (!requirePermission("surveys", "read")(auth, res)) return;
    const { data: survey, error } = await supabase.from("surveys").select("*").eq("id", m[1]).single();
    if (error || !survey) return res.status(404).json({ error: "Survey not found" });
    // college scope check
    if (auth.nexusUser.role === "college_rep" && auth.nexusUser.restricted_college_ids?.length && !auth.nexusUser.restricted_college_ids.includes(survey.college_id)) {
      return res.status(403).json({ error: "Survey not in your scope" });
    }
    return res.json({ survey });
  }

  // ---- PATCH /api/admin/surveys/:id ----
  if (m && req.method === "PATCH") {
    if (!requirePermission("surveys", "write")(auth, res)) return;
    if (blockCollegeRep(auth, res, "survey edits")) return;
    const surveyId = m[1];

    const { data: existing, error: loadErr } = await supabase.from("surveys").select("*").eq("id", surveyId).single();
    if (loadErr || !existing) return res.status(404).json({ error: "Survey not found" });

    const body = req.body || {};
    const update: Record<string, any> = {};
    const editable = ["title", "description", "audience_type", "college_id", "intro_markdown", "thank_you_markdown", "estimated_minutes", "status", "opens_at", "closes_at", "schema"];
    for (const k of editable) if (k in body) update[k] = body[k];

    // If survey is locked (has responses), only allow label/copy edits — not structural schema changes
    if (existing.locked_at && "schema" in update) {
      const structurallyValid = isOnlyLabelEdit(existing.schema, update.schema);
      if (!structurallyValid) {
        return res.status(409).json({
          error: "Survey is locked (has responses). Only label/copy edits allowed. Clone as new version for structural changes.",
        });
      }
    }

    const { data, error } = await supabase.from("surveys").update(update).eq("id", surveyId).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ survey: data });
  }

  // ---- POST /api/admin/surveys/:id/clone ----
  m = path.match(/^\/admin\/surveys\/([^/]+)\/clone$/);
  if (m && req.method === "POST") {
    if (!requirePermission("surveys", "write")(auth, res)) return;
    if (blockCollegeRep(auth, res, "survey cloning")) return;
    const { data: source } = await supabase.from("surveys").select("*").eq("id", m[1]).single();
    if (!source) return res.status(404).json({ error: "Source survey not found" });

    const { title, slug, audience_type, college_id } = req.body || {};
    const newTitle = title || `${source.title} (copy)`;
    const finalSlug = (slug || newTitle).toString().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80) + "-" + Math.random().toString(36).slice(2, 6);

    const { data, error } = await supabase.from("surveys").insert({
      slug: finalSlug,
      title: newTitle,
      description: source.description,
      audience_type: audience_type || source.audience_type,
      college_id: college_id !== undefined ? college_id : source.college_id,
      schema: source.schema,
      intro_markdown: source.intro_markdown,
      thank_you_markdown: source.thank_you_markdown,
      estimated_minutes: source.estimated_minutes,
      version: 1,
      parent_survey_id: source.id,
      created_by: auth.nexusUser.id,
      status: "draft",
    }).select().single();

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ survey: data });
  }

  // ---- GET /api/admin/surveys/:id/dashboard ----
  m = path.match(/^\/admin\/surveys\/([^/]+)\/dashboard$/);
  if (m && req.method === "GET") {
    if (!requirePermission("surveys", "read")(auth, res)) return;
    const surveyId = m[1];
    if (!(await assertSurveyInScope(surveyId, auth, res))) return;

    const [{ data: survey }, { data: respondents }, { data: responses }, { data: ratings }, { data: invites }] = await Promise.all([
      supabase.from("surveys").select("id, schema, status").eq("id", surveyId).single(),
      supabase.from("survey_respondents").select("id, last_login_at, industry, company_size").eq("survey_id", surveyId),
      supabase.from("survey_responses").select("respondent_id, section_key").eq("survey_id", surveyId),
      supabase.from("survey_skill_ratings").select("respondent_id").eq("survey_id", surveyId),
      supabase.from("survey_invites").select("status").eq("survey_id", surveyId),
    ]);

    if (!survey) return res.status(404).json({ error: "Survey not found" });

    const sections = (survey.schema?.sections || []) as any[];
    const totalSections = sections.length;

    const respondentSections: Record<string, Set<string>> = {};
    for (const r of responses || []) {
      if (!respondentSections[r.respondent_id]) respondentSections[r.respondent_id] = new Set();
      respondentSections[r.respondent_id].add(r.section_key);
    }

    const sectionsCompletion: Record<string, number> = {};
    for (const s of sections) sectionsCompletion[s.key] = 0;
    for (const set of Object.values(respondentSections)) {
      for (const key of set) {
        if (key in sectionsCompletion) sectionsCompletion[key]++;
      }
    }

    const totalRespondents = (respondents || []).length;
    const totalRegistered = (respondents || []).filter(r => r.last_login_at).length;
    const totalCompleted = totalSections > 0 ? Object.values(respondentSections).filter(set => set.size >= totalSections).length : 0;

    // Industry / company size breakdowns
    const byIndustry: Record<string, number> = {};
    const byCompanySize: Record<string, number> = {};
    for (const r of respondents || []) {
      if (r.industry) byIndustry[r.industry] = (byIndustry[r.industry] || 0) + 1;
      if (r.company_size) byCompanySize[r.company_size] = (byCompanySize[r.company_size] || 0) + 1;
    }

    const inviteCounts: Record<string, number> = {};
    for (const i of invites || []) inviteCounts[i.status] = (inviteCounts[i.status] || 0) + 1;

    return res.json({
      total_invited: (invites || []).length,
      total_respondents: totalRespondents,
      total_registered: totalRegistered,
      total_completed: totalCompleted,
      completion_rate: totalRespondents > 0 ? Math.round((totalCompleted / totalRespondents) * 1000) / 10 : 0,
      sections_completion: sectionsCompletion,
      total_skills_rated: (ratings || []).length,
      responses_by_industry: Object.entries(byIndustry).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      responses_by_company_size: Object.entries(byCompanySize).map(([name, count]) => ({ name, count })),
      invite_counts: inviteCounts,
    });
  }

  // ---- GET /api/admin/surveys/:id/respondents ----
  m = path.match(/^\/admin\/surveys\/([^/]+)\/respondents$/);
  if (m && req.method === "GET") {
    if (!requirePermission("surveys", "read")(auth, res)) return;
    const surveyId = m[1];
    if (!(await assertSurveyInScope(surveyId, auth, res))) return;
    const { page = "1", limit = "20", status: filterStatus, search } = req.query as Record<string, string>;
    const pageNum = parseInt(page) || 1;
    const limitNum = Math.min(parseInt(limit) || 20, 100);
    const offset = (pageNum - 1) * limitNum;

    let q = supabase.from("survey_respondents").select("*", { count: "exact" }).eq("survey_id", surveyId).order("created_at", { ascending: false });
    if (search) q = q.or(`email.ilike.%${search}%,full_name.ilike.%${search}%,company_name.ilike.%${search}%`);
    q = q.range(offset, offset + limitNum - 1);
    const { data: respondents, count, error: rErr } = await q;
    if (rErr) return res.status(500).json({ error: rErr.message });

    const respIds = (respondents || []).map(r => r.id);
    const [{ data: pageResponses }, { data: pageRatings }, { data: survey }] = await Promise.all([
      respIds.length ? supabase.from("survey_responses").select("respondent_id, section_key").in("respondent_id", respIds).eq("survey_id", surveyId) : Promise.resolve({ data: [] }),
      respIds.length ? supabase.from("survey_skill_ratings").select("respondent_id").in("respondent_id", respIds).eq("survey_id", surveyId) : Promise.resolve({ data: [] }),
      supabase.from("surveys").select("schema").eq("id", surveyId).single(),
    ]);
    const totalSections = (survey?.schema?.sections || []).length;

    const sectionsByR: Record<string, Set<string>> = {};
    const ratingsByR: Record<string, number> = {};
    for (const r of pageResponses || []) {
      if (!sectionsByR[r.respondent_id]) sectionsByR[r.respondent_id] = new Set();
      sectionsByR[r.respondent_id].add(r.section_key);
    }
    for (const r of pageRatings || []) ratingsByR[r.respondent_id] = (ratingsByR[r.respondent_id] || 0) + 1;

    let enriched = (respondents || []).map((resp: any) => {
      const sections = sectionsByR[resp.id] ? [...sectionsByR[resp.id]] : [];
      return {
        id: resp.id,
        email: resp.email,
        full_name: resp.full_name,
        company_name: resp.company_name,
        designation: resp.designation,
        industry: resp.industry,
        status: determineSurveyStatus(resp, sections, totalSections),
        sections_completed: sections,
        skills_rated: ratingsByR[resp.id] || 0,
        created_at: resp.created_at,
        last_login_at: resp.last_login_at,
      };
    });
    if (filterStatus && filterStatus !== "all") enriched = enriched.filter((r: any) => r.status === filterStatus);

    return res.json({ respondents: enriched, total: count || 0, page: pageNum });
  }

  // ---- GET /api/admin/surveys/:id/respondents/:respondentId ----
  m = path.match(/^\/admin\/surveys\/([^/]+)\/respondents\/([^/]+)$/);
  if (m && req.method === "GET") {
    if (!requirePermission("surveys", "read")(auth, res)) return;
    const [, surveyId, respondentId] = m;
    if (!(await assertSurveyInScope(surveyId, auth, res))) return;
    const [{ data: respondent }, { data: responses }, { data: ratings }] = await Promise.all([
      supabase.from("survey_respondents").select("*").eq("id", respondentId).eq("survey_id", surveyId).single(),
      supabase.from("survey_responses").select("*").eq("respondent_id", respondentId).eq("survey_id", surveyId).order("section_key"),
      supabase.from("survey_skill_ratings").select("*").eq("respondent_id", respondentId).eq("survey_id", surveyId).order("skill_name"),
    ]);
    if (!respondent) return res.status(404).json({ error: "Respondent not found" });
    return res.json({ respondent, responses: responses || [], skill_ratings: ratings || [] });
  }

  // ---- POST /api/admin/surveys/:id/invites (bulk add + queue email send) ----
  m = path.match(/^\/admin\/surveys\/([^/]+)\/invites$/);
  if (m && req.method === "POST") {
    if (!requirePermission("surveys", "write")(auth, res)) return;
    const surveyId = m[1];
    if (!(await assertSurveyInScope(surveyId, auth, res))) return;
    const { emails, send_now = true } = req.body || {};
    if (!Array.isArray(emails) || !emails.length) return res.status(400).json({ error: "emails array is required" });

    const { data: survey } = await supabase.from("surveys").select("id, slug, title, status").eq("id", surveyId).single();
    if (!survey) return res.status(404).json({ error: "Survey not found" });
    const open = isOpenForResponses(survey);
    if (!open.open) return res.status(400).json({ error: `Cannot send invites: ${open.reason}` });

    const surveyUrl = `${process.env.APP_URL || "https://nexus.boardinfinity.com"}/#/s/${survey.slug}`;
    const results: Array<{ email: string; status: string; error?: string }> = [];

    for (const rawEmail of emails) {
      const email = (rawEmail as string).toLowerCase().trim();
      if (!email || !email.includes("@")) {
        results.push({ email: rawEmail, status: "failed", error: "Invalid email" });
        continue;
      }

      // Upsert invite
      const { error: invErr } = await supabase.from("survey_invites").upsert(
        { survey_id: surveyId, email, invited_by: auth.nexusUser.id, status: "pending" },
        { onConflict: "survey_id,email" }
      );
      if (invErr) { results.push({ email, status: "failed", error: invErr.message }); continue; }

      if (!send_now) { results.push({ email, status: "pending" }); continue; }

      const sendResult = await sendEmail({
        to: email,
        subject: `You're invited: ${survey.title}`,
        text: `You've been invited to participate in "${survey.title}".\n\nOpen the survey: ${surveyUrl}\n\nWhen you click the link, you'll be asked to verify your email with a one-time code.`,
        html: basicHtmlTemplate({
          title: `You're invited to: ${survey.title}`,
          body_html: `<p>You've been invited to participate in <strong>${survey.title}</strong>.</p><p>When you open the survey, you'll be asked to verify your email with a one-time code (sent instantly).</p>`,
          cta_label: "Open Survey",
          cta_url: surveyUrl,
        }),
        tags: ["nexus-survey", "survey-invite", `slug:${survey.slug}`],
        metadata: { purpose: "survey_invite", survey_id: surveyId, slug: survey.slug, email },
      });

      if (sendResult.ok) {
        await supabase.from("survey_invites").update({ status: "sent", invite_sent_at: new Date().toISOString() }).eq("survey_id", surveyId).eq("email", email);
        results.push({ email, status: "sent" });
      } else {
        await supabase.from("survey_invites").update({ status: "failed", bounced_reason: sendResult.error }).eq("survey_id", surveyId).eq("email", email);
        results.push({ email, status: "failed", error: sendResult.error });
      }
    }

    return res.json({
      results,
      total: results.length,
      successful: results.filter(r => r.status === "sent" || r.status === "pending").length,
      failed: results.filter(r => r.status === "failed").length,
    });
  }

  // ---- GET /api/admin/surveys/:id/invites ----
  if (m && req.method === "GET") {
    if (!requirePermission("surveys", "read")(auth, res)) return;
    const surveyId = m[1];
    if (!(await assertSurveyInScope(surveyId, auth, res))) return;
    const { data, error } = await supabase.from("survey_invites").select("*").eq("survey_id", surveyId).order("created_at", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ invites: data || [] });
  }

  // ---- POST /api/admin/surveys/:id/remind ----
  m = path.match(/^\/admin\/surveys\/([^/]+)\/remind$/);
  if (m && req.method === "POST") {
    if (!requirePermission("surveys", "write")(auth, res)) return;
    const surveyId = m[1];
    if (!(await assertSurveyInScope(surveyId, auth, res))) return;
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: "email is required" });

    const { data: survey } = await supabase.from("surveys").select("id, slug, title, status").eq("id", surveyId).single();
    if (!survey) return res.status(404).json({ error: "Survey not found" });
    const open = isOpenForResponses(survey);
    if (!open.open) return res.status(400).json({ error: `Cannot send reminder: ${open.reason}` });

    const surveyUrl = `${process.env.APP_URL || "https://nexus.boardinfinity.com"}/#/s/${survey.slug}`;
    const result = await sendEmail({
      to: email,
      subject: `Reminder: ${survey.title}`,
      text: `This is a reminder to complete "${survey.title}".\n\nOpen the survey: ${surveyUrl}`,
      html: basicHtmlTemplate({
        title: `Reminder: ${survey.title}`,
        body_html: `<p>This is a reminder to complete the survey.</p>`,
        cta_label: "Open Survey",
        cta_url: surveyUrl,
      }),
      tags: ["nexus-survey", "survey-reminder", `slug:${survey.slug}`],
      metadata: { purpose: "survey_reminder", survey_id: surveyId, slug: survey.slug, email },
    });

    if (result.ok) {
      await supabase.from("survey_invites").update({
        last_reminder_at: new Date().toISOString(),
        reminder_count: (await supabase.from("survey_invites").select("reminder_count").eq("survey_id", surveyId).eq("email", email).maybeSingle()).data?.reminder_count + 1 || 1,
      }).eq("survey_id", surveyId).eq("email", email);
    }
    return res.json({ success: result.ok, error: result.error });
  }

  // ---- GET /api/admin/surveys/:id/analytics ----
  m = path.match(/^\/admin\/surveys\/([^/]+)\/analytics$/);
  if (m && req.method === "GET") {
    if (!requirePermission("surveys", "read")(auth, res)) return;
    const surveyId = m[1];
    if (!(await assertSurveyInScope(surveyId, auth, res))) return;

    const [{ data: responses }, { data: ratings }, { data: respondents }] = await Promise.all([
      supabase.from("survey_responses").select("*").eq("survey_id", surveyId),
      supabase.from("survey_skill_ratings").select("*").eq("survey_id", surveyId),
      supabase.from("survey_respondents").select("*").eq("survey_id", surveyId),
    ]);

    // Skill matrix aggregation (only meaningful if survey has a skill_matrix question)
    const skillAggs: Record<string, { impSum: number; demSum: number; count: number }> = {};
    for (const r of ratings || []) {
      if (!skillAggs[r.skill_name]) skillAggs[r.skill_name] = { impSum: 0, demSum: 0, count: 0 };
      skillAggs[r.skill_name].impSum += r.importance_rating || 0;
      skillAggs[r.skill_name].demSum += r.demonstration_rating || 0;
      skillAggs[r.skill_name].count++;
    }
    const skillComparison = Object.entries(skillAggs).map(([skill, agg]) => ({
      skill,
      importance: Math.round((agg.impSum / agg.count) * 10) / 10,
      demonstration: Math.round((agg.demSum / agg.count) * 10) / 10,
      gap: Math.round(((agg.impSum - agg.demSum) / agg.count) * 10) / 10,
      respondent_count: agg.count,
    })).sort((a, b) => b.gap - a.gap);

    // Generic per-question aggregation (counts of values for choice types)
    const responseAggsByQ: Record<string, Record<string, number>> = {};
    for (const r of responses || []) {
      const k = `${r.section_key}::${r.question_key}::${r.response_type}`;
      if (!responseAggsByQ[k]) responseAggsByQ[k] = {};
      const val = r.response_value;
      const items: any[] = Array.isArray(val) ? val : [val];
      for (const it of items) {
        const label = typeof it === "string" || typeof it === "number" || typeof it === "boolean" ? String(it) : JSON.stringify(it);
        responseAggsByQ[k][label] = (responseAggsByQ[k][label] || 0) + 1;
      }
    }

    return res.json({
      total_respondents: (respondents || []).length,
      total_responses: (responses || []).length,
      total_ratings: (ratings || []).length,
      skill_comparison: skillComparison,
      biggest_gaps: skillComparison.slice(0, 10),
      most_adequate: [...skillComparison].sort((a, b) => a.gap - b.gap).slice(0, 10),
      response_aggregations: responseAggsByQ,
    });
  }

  // ---- POST /api/admin/surveys/parse-doc ----
  // Multipart upload: extract plain text from a .docx or .pdf for the AI generator.
  // The body is the raw multipart payload; we read it from the stream.
  if (path === "/admin/surveys/parse-doc" && req.method === "POST") {
    if (!requirePermission("surveys", "write")(auth, res)) return;
    if (blockCollegeRep(auth, res, "document parsing")) return;
    try {
      const text = await parseUploadedDocText(req);
      return res.json({ text, length: text.length });
    } catch (err: any) {
      return res.status(400).json({ error: err.message || "Failed to parse document" });
    }
  }

  // ---- POST /api/admin/surveys/generate ----
  // AI-generated schema. Body: { mode: "brief"|"doc"|"clone", brief?, doc_text?, source_survey_id?, audience_type, college_id? }
  // Returns { schema, suggested_title, suggested_description, estimated_minutes }.
  if (path === "/admin/surveys/generate" && req.method === "POST") {
    if (!requirePermission("surveys", "write")(auth, res)) return;
    if (blockCollegeRep(auth, res, "AI generation")) return;

    const { mode, brief, doc_text, source_survey_id, audience_type } = req.body || {};
    if (!mode || !audience_type) return res.status(400).json({ error: "mode and audience_type are required" });

    let sourceText = "";
    if (mode === "brief") {
      if (!brief || typeof brief !== "string" || brief.trim().length < 20) {
        return res.status(400).json({ error: "brief must be a description of at least 20 characters" });
      }
      sourceText = brief.trim();
    } else if (mode === "doc") {
      if (!doc_text || typeof doc_text !== "string" || doc_text.trim().length < 50) {
        return res.status(400).json({ error: "doc_text must be at least 50 characters (call /parse-doc first)" });
      }
      sourceText = doc_text.trim().slice(0, 60000);
    } else if (mode === "clone") {
      if (!source_survey_id) return res.status(400).json({ error: "source_survey_id required for clone mode" });
      const { data: src } = await supabase.from("surveys").select("title, description, schema, audience_type, estimated_minutes").eq("id", source_survey_id).single();
      if (!src) return res.status(404).json({ error: "Source survey not found" });
      // Clone returns the source schema directly (deep copy with regenerated slug suggestion). No AI call needed.
      return res.json({
        schema: src.schema || { sections: [], settings: {} },
        suggested_title: `${src.title} (copy)`,
        suggested_description: src.description || "",
        estimated_minutes: src.estimated_minutes || null,
        source: "clone",
      });
    } else {
      return res.status(400).json({ error: "mode must be one of: brief, doc, clone" });
    }

    const prompt = buildSurveyGeneratorPrompt(sourceText, audience_type, mode);
    let raw: string;
    try {
      raw = await callClaude(prompt, SURVEY_SCHEMA_TOOL_INPUT);
    } catch (err: any) {
      console.error("[admin/surveys/generate] AI call failed:", err.message);
      return res.status(502).json({ error: "AI generation failed: " + err.message });
    }

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return res.status(502).json({ error: "AI returned invalid JSON" });
    }

    // Sanity-check + normalize
    const normalized = normalizeGeneratedSchema(parsed);
    if (!normalized.ok) return res.status(502).json({ error: normalized.error });

    return res.json({
      schema: normalized.schema,
      suggested_title: normalized.title,
      suggested_description: normalized.description,
      estimated_minutes: normalized.estimated_minutes,
      source: mode,
    });
  }

  return res.status(404).json({ error: "Survey admin endpoint not found", path });
}

// ==================== AI generator helpers ====================

// JSON schema fed to Claude as the tool's input_schema. Keep this in sync with the
// SurveyQuestion type in client/src/lib/survey-api.ts.
const SURVEY_SCHEMA_TOOL_INPUT = {
  type: "object",
  required: ["title", "description", "estimated_minutes", "sections"],
  properties: {
    title: { type: "string", description: "Concise survey title (max 80 chars)" },
    description: { type: "string", description: "1-2 sentence respondent-facing description" },
    estimated_minutes: { type: "integer", minimum: 1, maximum: 60 },
    sections: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["key", "title", "questions"],
        properties: {
          key: { type: "string", description: "snake_case slug, unique within survey" },
          title: { type: "string" },
          description: { type: "string" },
          questions: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              required: ["key", "type", "label"],
              properties: {
                key: { type: "string", description: "snake_case slug, unique within section" },
                type: {
                  type: "string",
                  enum: ["text", "long_text", "single_choice", "multi_choice", "scale", "email", "date", "skill_matrix", "matrix_rating", "ranked_list", "master_select"],
                },
                label: { type: "string" },
                description: { type: "string" },
                required: { type: "boolean" },
                profile_field: {
                  type: "string",
                  enum: ["full_name", "company_name", "designation", "industry", "company_size", "years_of_experience", "location_city", "location_country"],
                  description: "If set, this answer is stored on survey_respondents columns instead of survey_responses (use for identity/profile questions only)",
                },
                options: {
                  type: "array",
                  description: "Required for single_choice and multi_choice",
                  items: {
                    type: "object",
                    required: ["value", "label"],
                    properties: {
                      value: { type: "string" },
                      label: { type: "string" },
                    },
                  },
                },
                scale_min: { type: "integer" },
                scale_max: { type: "integer" },
                scale_min_label: { type: "string" },
                scale_max_label: { type: "string" },
                skill_categories: {
                  type: "array",
                  description: "For skill_matrix only: filter the master taxonomy to these categories",
                  items: { type: "string" },
                },
                min_skills: { type: "integer", description: "For skill_matrix: minimum number of skills the respondent must rate" },
                master: {
                  type: "string",
                  enum: ["skills", "industries", "functions", "families", "colleges"],
                  description: "For master_select: which master list to source options from",
                },
                master_multi: {
                  type: "boolean",
                  description: "For master_select: allow multiple selections (default false)",
                },
                master_categories: {
                  type: "array",
                  items: { type: "string" },
                  description: "For master_select with master='skills': filter to these categories",
                },
                master_max: {
                  type: "integer",
                  description: "For master_select with master_multi=true: maximum number of selections allowed",
                },
                rows: {
                  type: "array",
                  description: "For matrix_rating: row labels (e.g. attributes being rated)",
                  items: {
                    type: "object",
                    required: ["key", "label"],
                    properties: { key: { type: "string" }, label: { type: "string" } },
                  },
                },
                cols: {
                  type: "array",
                  description: "For matrix_rating: column labels (e.g. rating scale)",
                  items: {
                    type: "object",
                    required: ["key", "label"],
                    properties: { key: { type: "string" }, label: { type: "string" } },
                  },
                },
                items: {
                  type: "array",
                  description: "For ranked_list: items the respondent should rank",
                  items: {
                    type: "object",
                    required: ["key", "label"],
                    properties: { key: { type: "string" }, label: { type: "string" } },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

function buildSurveyGeneratorPrompt(source: string, audienceType: string, mode: string): string {
  return `You are a survey designer for the Nexus alumni-and-employer intelligence platform. Generate a clean, well-structured survey schema based on the source material below.

## Audience
The survey is for: **${audienceType}** (one of: employer, industry_sme, alumni, faculty, student, other).

## Source (${mode})
"""
${source}
"""

## Rules
1. Produce 3 to 7 sections. Each section should have 3 to 12 questions.
2. The first section should always capture respondent identity. Use profile_field for these (full_name, company_name, designation, industry, years_of_experience, location_city, location_country, company_size). Do NOT invent extra identity questions outside that whitelist.
3. Use type "email" for email capture; use type "text" for short answers (<200 chars); use "long_text" for free-form > 200 chars.
4. Prefer "single_choice" / "multi_choice" with concrete options over open text whenever the source enumerates choices.
5. "scale" is for 1–5, 1–10, or NPS-style ratings. Always set scale_min, scale_max, scale_min_label, scale_max_label.
6. "skill_matrix" is special: it pulls from the master skill taxonomy and asks for both Importance and Demonstration ratings (1–5 stars each). Use it ONLY when the source explicitly asks about skills relevant to a role. Set min_skills (default 5) and optionally skill_categories to filter the catalog. There should be AT MOST one skill_matrix question per survey.
6a. "master_select" is a searchable dropdown sourced from one of the platform master lists. Use it whenever the source mentions picking from a known reference set instead of a custom list. Set master to one of: "skills" (the skills taxonomy, ~9000 entries), "industries" (~15), "functions" (~26 LinkedIn-aligned), "families" (~20 job families), "colleges" (~1000 colleges in the platform). Set master_multi: true if the question allows multiple picks; optionally master_max to cap selections. For master='skills' you may also pass master_categories to narrow the catalog. Prefer master_select over hand-coded options whenever the source asks about industry, function, family, college, or a free "list your skills" question (use master_select with master='skills', master_multi=true, master_max=5–10 instead of long_text).
7. "matrix_rating" is a generic rows × cols rating grid (e.g. "Rate each attribute on a 5-point scale").
8. "ranked_list" asks the respondent to drag-rank a fixed set of items.
9. "date" produces a calendar picker (use for graduation date, joining date, etc).
10. All keys are snake_case, lowercase, alphanumeric + underscores, unique within their parent.
11. "required" defaults to true. Only set required: false for genuinely optional questions.
12. Mark a sensible estimated_minutes (typically 5–20 minutes for 20–40 questions).
13. Output ONLY a valid call to the extract_data tool with the schema described.`;
}

function normalizeGeneratedSchema(input: any): { ok: true; schema: any; title: string; description: string; estimated_minutes: number | null } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "AI did not return an object" };
  const title = String(input.title || "").slice(0, 200) || "Untitled Survey";
  const description = String(input.description || "").slice(0, 1000);
  const estimated_minutes = typeof input.estimated_minutes === "number" ? input.estimated_minutes : null;
  const sections = Array.isArray(input.sections) ? input.sections : [];
  if (sections.length === 0) return { ok: false, error: "AI returned no sections" };

  const usedSecKeys = new Set<string>();
  const cleanSections: any[] = [];
  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i] || {};
    let secKey = slugify(sec.key || sec.title || `section_${i + 1}`);
    while (usedSecKeys.has(secKey)) secKey = secKey + "_x";
    usedSecKeys.add(secKey);
    const usedQKeys = new Set<string>();
    const qs = Array.isArray(sec.questions) ? sec.questions : [];
    const cleanQs: any[] = [];
    for (let j = 0; j < qs.length; j++) {
      const q = qs[j] || {};
      if (!q.type || !q.label) continue;
      let qKey = slugify(q.key || q.label || `q_${j + 1}`);
      while (usedQKeys.has(qKey)) qKey = qKey + "_x";
      usedQKeys.add(qKey);
      cleanQs.push({ ...q, key: qKey });
    }
    if (cleanQs.length === 0) continue;
    cleanSections.push({
      key: secKey,
      title: String(sec.title || `Section ${i + 1}`).slice(0, 200),
      description: sec.description ? String(sec.description).slice(0, 600) : undefined,
      questions: cleanQs,
    });
  }
  if (cleanSections.length === 0) return { ok: false, error: "AI returned no usable questions" };

  return {
    ok: true,
    schema: { sections: cleanSections, settings: {} },
    title,
    description,
    estimated_minutes,
  };
}

function slugify(s: string): string {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/(^_|_$)/g, "").slice(0, 60) || "section";
}

// ==================== Document parsing for /parse-doc ====================
// Reads the raw request body (Vercel disables bodyParser only when configured;
// we rely on the runtime giving us a Buffer or string for non-JSON content types).
// Simple multipart parse: pull the first file part out of the body.

async function readRawBody(req: VercelRequest): Promise<Buffer> {
  // If Vercel already parsed the body (when content-type is application/json) it's an object;
  // for multipart we need the raw stream.
  if (Buffer.isBuffer(req.body)) return req.body as Buffer;
  if (typeof (req as any).body === "string") return Buffer.from((req as any).body);
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: any) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function parseUploadedDocText(req: VercelRequest): Promise<string> {
  const ct = String(req.headers["content-type"] || "");

  // Plain text JSON body fallback: { filename, content_base64 }
  if (ct.includes("application/json")) {
    const body = req.body || {};
    const filename = String(body.filename || "").toLowerCase();
    const b64 = body.content_base64;
    if (!b64 || typeof b64 !== "string") throw new Error("content_base64 required");
    const buf = Buffer.from(b64, "base64");
    return await extractText(buf, filename);
  }

  // Multipart form-data
  if (ct.includes("multipart/form-data")) {
    const boundaryMatch = ct.match(/boundary=([^;]+)/);
    if (!boundaryMatch) throw new Error("Missing multipart boundary");
    const boundary = boundaryMatch[1].replace(/^"|"$/g, "");
    const raw = await readRawBody(req);
    const file = extractFirstFilePart(raw, boundary);
    if (!file) throw new Error("No file part in upload");
    return await extractText(file.content, (file.filename || "").toLowerCase());
  }

  throw new Error("Unsupported content type: " + ct);
}

function extractFirstFilePart(raw: Buffer, boundary: string): { filename: string; content: Buffer } | null {
  const sep = Buffer.from("--" + boundary);
  const segments: Buffer[] = [];
  let pos = raw.indexOf(sep);
  while (pos !== -1) {
    const next = raw.indexOf(sep, pos + sep.length);
    if (next === -1) break;
    segments.push(raw.subarray(pos + sep.length, next));
    pos = next;
  }
  for (const seg of segments) {
    const headerEnd = seg.indexOf("\r\n\r\n");
    if (headerEnd === -1) continue;
    const headers = seg.subarray(0, headerEnd).toString("utf-8");
    const fnMatch = headers.match(/filename=\"([^\"]*)\"/);
    if (!fnMatch) continue;
    let body = seg.subarray(headerEnd + 4);
    // Trim trailing \r\n
    if (body.length >= 2 && body[body.length - 2] === 0x0d && body[body.length - 1] === 0x0a) {
      body = body.subarray(0, body.length - 2);
    }
    return { filename: fnMatch[1], content: body };
  }
  return null;
}

async function extractText(buf: Buffer, filename: string): Promise<string> {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".docx")) {
    const result = await mammoth.extractRawText({ buffer: buf });
    return (result.value || "").trim();
  }
  if (lower.endsWith(".pdf")) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pdfParse = require("pdf-parse");
    const result = await pdfParse(buf);
    return (result.text || "").trim();
  }
  if (lower.endsWith(".txt") || lower.endsWith(".md")) {
    return buf.toString("utf-8").trim();
  }
  throw new Error("Unsupported file type. Use .docx, .pdf, .txt, or .md");
}

// ==================== Schema lock-edit validator ====================
// Returns true if the new schema only differs from old in labels/copy/option labels
// (allowed) — false if structural fields change (key/type/scale/options[].value).

function isOnlyLabelEdit(oldSchema: any, newSchema: any): boolean {
  if (!oldSchema || !newSchema) return false;
  const oldSecs = oldSchema.sections || [];
  const newSecs = newSchema.sections || [];
  if (oldSecs.length !== newSecs.length) return false;
  for (let i = 0; i < oldSecs.length; i++) {
    const a = oldSecs[i], b = newSecs[i];
    if (a.key !== b.key) return false;
    const aQs = a.questions || [], bQs = b.questions || [];
    if (aQs.length !== bQs.length) return false;
    for (let j = 0; j < aQs.length; j++) {
      const qa = aQs[j], qb = bQs[j];
      if (qa.key !== qb.key) return false;
      if (qa.type !== qb.type) return false;
      if (qa.required !== qb.required) return false;
      if ((qa.min ?? null) !== (qb.min ?? null)) return false;
      if ((qa.max ?? null) !== (qb.max ?? null)) return false;
      // option values must match (labels can change)
      const aOpts = (qa.options || []).map((o: any) => typeof o === "string" ? o : o.value);
      const bOpts = (qb.options || []).map((o: any) => typeof o === "string" ? o : o.value);
      if (aOpts.length !== bOpts.length) return false;
      for (let k = 0; k < aOpts.length; k++) if (aOpts[k] !== bOpts[k]) return false;
    }
  }
  return true;
}

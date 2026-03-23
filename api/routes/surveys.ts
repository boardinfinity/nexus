import type { VercelRequest, VercelResponse } from "@vercel/node";
import * as bcrypt from "bcryptjs";
import * as jwt from "jsonwebtoken";
import { AuthResult, requirePermission, verifyAuth } from "../lib/auth";
import { supabase, JWT_SECRET, RESEND_API_KEY } from "../lib/supabase";
import { generateSecureOtp } from "../lib/helpers";

// ==================== INTERNAL HELPERS ====================

function verifySurveyJwt(req: VercelRequest): { respondent_id: string; email: string } | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { respondent_id: string; email: string };
    return decoded;
  } catch {
    return null;
  }
}

const SURVEY_SECTIONS = ["profile", "hiring_overview", "skill_ratings", "gap_analysis", "emerging_trends"];

// ==================== PUBLIC SURVEY ROUTES (pre-auth) ====================

export async function handleSurveyRoutes(path: string, req: VercelRequest, res: VercelResponse): Promise<VercelResponse> {
  // ---- POST /api/survey/auth/send-otp ----
  if (path === "/survey/auth/send-otp" && req.method === "POST") {
    const { email } = req.body || {};
    if (!email || typeof email !== "string") {
      return res.status(400).json({ error: "Email is required" });
    }
    const normalizedEmail = email.toLowerCase().trim();

    const otp = generateSecureOtp(6);
    const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const hashedOtp = await bcrypt.hash(otp, 10);

    const { error } = await supabase.from("survey_respondents").upsert(
      { email: normalizedEmail, auth_otp: hashedOtp, auth_otp_expires: expires },
      { onConflict: "email" }
    );
    if (error) return res.status(500).json({ error: error.message });

    // Send OTP via Resend if configured, otherwise log to console
    if (RESEND_API_KEY) {
      try {
        const emailRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: process.env.RESEND_FROM_EMAIL || "Nexus Survey <onboarding@resend.dev>",
            to: [normalizedEmail],
            subject: "Your Nexus Survey Access Code",
            text: `Your one-time code is: ${otp}\n\nValid for 15 minutes.`,
          }),
        });
        const emailBody = await emailRes.json();
        if (!emailRes.ok) {
          console.error(`[SURVEY OTP] Resend API error (${emailRes.status}):`, JSON.stringify(emailBody));
          console.log(`[SURVEY OTP FALLBACK] Email: ${normalizedEmail}, OTP: ${otp}`);
        } else {
          console.log(`[SURVEY OTP] Sent via Resend to ${normalizedEmail}, id: ${emailBody.id}`);
        }
      } catch (emailErr: any) {
        console.error("[SURVEY OTP] Failed to send email:", emailErr.message);
        console.log(`[SURVEY OTP FALLBACK] Email: ${normalizedEmail}, OTP: ${otp}`);
      }
    } else {
      console.log(`[SURVEY OTP] No RESEND_API_KEY configured. Email: ${normalizedEmail}, OTP: ${otp}`);
    }

    return res.json({ message: "OTP sent to your email" });
  }

  // ---- POST /api/survey/auth/verify-otp ----
  if (path === "/survey/auth/verify-otp" && req.method === "POST") {
    const { email, otp } = req.body || {};
    if (!email || !otp) {
      return res.status(400).json({ error: "Email and OTP are required" });
    }
    const normalizedEmail = email.toLowerCase().trim();

    const { data: respondent, error } = await supabase
      .from("survey_respondents")
      .select("id, auth_otp, auth_otp_expires")
      .eq("email", normalizedEmail)
      .single();

    if (error || !respondent) {
      return res.status(404).json({ error: "Email not found. Please request a new OTP." });
    }
    if (!respondent.auth_otp || !respondent.auth_otp_expires) {
      return res.status(400).json({ error: "No OTP pending. Please request a new one." });
    }
    if (new Date(respondent.auth_otp_expires) < new Date()) {
      return res.status(400).json({ error: "OTP has expired. Please request a new one." });
    }
    const isValid = await bcrypt.compare(otp, respondent.auth_otp);
    if (!isValid) {
      return res.status(400).json({ error: "Invalid OTP" });
    }

    // Clear OTP and update login time
    await supabase.from("survey_respondents").update({
      auth_otp: null,
      auth_otp_expires: null,
      last_login_at: new Date().toISOString(),
    }).eq("id", respondent.id);

    const token = jwt.sign(
      { respondent_id: respondent.id, email: normalizedEmail },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.json({ token, respondent_id: respondent.id });
  }

  // ---- POST /api/survey/auth/register ----
  // Called after Supabase Auth OTP verification succeeds on the frontend.
  // Creates/upserts a survey_respondents record and issues a survey JWT.
  if (path === "/survey/auth/register" && req.method === "POST") {
    const { email } = req.body || {};
    if (!email || typeof email !== "string") {
      return res.status(400).json({ error: "Email is required" });
    }
    const normalizedEmail = email.toLowerCase().trim();

    // Upsert respondent (create if first time, update last_login if returning)
    const { data: respondent, error } = await supabase
      .from("survey_respondents")
      .upsert(
        { email: normalizedEmail, last_login_at: new Date().toISOString() },
        { onConflict: "email" }
      )
      .select("id")
      .single();

    if (error || !respondent) {
      return res.status(500).json({ error: error?.message || "Failed to register respondent" });
    }

    const token = jwt.sign(
      { respondent_id: respondent.id, email: normalizedEmail },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.json({ token, respondent_id: respondent.id });
  }

  // ---- GET /api/survey/skill-list (public) ----
  if (path === "/survey/skill-list" && req.method === "GET") {
    const { data: skills, error } = await supabase
      .from("taxonomy_skills")
      .select("id, name, category")
      .order("category")
      .order("name");

    if (error) return res.status(500).json({ error: error.message });

    // Group by category
    const grouped: Record<string, { id: string; name: string }[]> = {};
    for (const skill of skills || []) {
      const cat = skill.category || "Other";
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push({ id: skill.id, name: skill.name });
    }

    return res.json(grouped);
  }

  // ---- All routes below require survey JWT ----
  const surveyAuth = verifySurveyJwt(req);
  if (!surveyAuth) {
    return res.status(401).json({ error: "Survey authentication required" });
  }

  // ---- GET /api/survey/progress ----
  if (path === "/survey/progress" && req.method === "GET") {
    const respondentId = surveyAuth.respondent_id;

    // Check profile completion
    const { data: respondent } = await supabase
      .from("survey_respondents")
      .select("full_name, company_name, designation, industry, company_size, years_of_experience, location_city, location_country")
      .eq("id", respondentId)
      .single();

    const profileFields = respondent
      ? [respondent.full_name, respondent.company_name, respondent.designation, respondent.industry, respondent.company_size].filter(Boolean)
      : [];
    const profileStatus = profileFields.length >= 5 ? "complete" : profileFields.length > 0 ? "in_progress" : "pending";

    // Check section responses
    const { data: responses } = await supabase
      .from("survey_responses")
      .select("section_key, question_key")
      .eq("respondent_id", respondentId);

    const sectionCounts: Record<string, number> = {};
    for (const r of responses || []) {
      sectionCounts[r.section_key] = (sectionCounts[r.section_key] || 0) + 1;
    }

    // Check skill ratings
    const { count: skillCount } = await supabase
      .from("survey_skill_ratings")
      .select("id", { count: "exact", head: true })
      .eq("respondent_id", respondentId);

    // Required question counts per section
    const requiredCounts: Record<string, number> = {
      hiring_overview: 5,
      gap_analysis: 4,
      emerging_trends: 3,
    };

    const getStatus = (key: string) => {
      if (key === "profile") return profileStatus;
      if (key === "skill_ratings") {
        if ((skillCount || 0) >= 10) return "complete";
        if ((skillCount || 0) > 0) return "in_progress";
        return "pending";
      }
      const count = sectionCounts[key] || 0;
      const required = requiredCounts[key] || 1;
      if (count >= required) return "complete";
      if (count > 0) return "in_progress";
      return "pending";
    };

    const progress: Record<string, string> = {};
    let completedSections = 0;
    for (const section of SURVEY_SECTIONS) {
      progress[section] = getStatus(section);
      if (progress[section] === "complete") completedSections++;
    }

    return res.json({
      ...progress,
      total_pct: Math.round((completedSections / SURVEY_SECTIONS.length) * 100),
    });
  }

  // ---- POST /api/survey/responses ----
  if (path === "/survey/responses" && req.method === "POST") {
    const respondentId = surveyAuth.respondent_id;
    const { section_key, responses, profile, skill_ratings } = req.body || {};

    // Handle profile update (Section A)
    if (section_key === "profile" && profile) {
      const { error } = await supabase
        .from("survey_respondents")
        .update({
          full_name: profile.full_name || null,
          company_name: profile.company_name || null,
          designation: profile.designation || null,
          industry: profile.industry || null,
          company_size: profile.company_size || null,
          years_of_experience: profile.years_of_experience != null ? parseInt(profile.years_of_experience) : null,
          location_city: profile.location_city || null,
          location_country: profile.location_country || null,
        })
        .eq("id", respondentId);
      if (error) return res.status(500).json({ error: error.message });
      return res.json({ saved: true, section_key: "profile" });
    }

    // Handle skill ratings (Section C)
    if (section_key === "skill_ratings" && skill_ratings) {
      for (const rating of skill_ratings) {
        const { error } = await supabase.from("survey_skill_ratings").upsert(
          {
            respondent_id: respondentId,
            skill_name: rating.skill_name,
            taxonomy_skill_id: rating.taxonomy_skill_id || null,
            importance_rating: rating.importance_rating || null,
            demonstration_rating: rating.demonstration_rating || null,
            is_custom_skill: rating.is_custom_skill || false,
          },
          { onConflict: "respondent_id,skill_name" }
        );
        if (error) {
          console.error("Skill rating upsert error:", error);
        }
      }
      return res.json({ saved: true, section_key: "skill_ratings", count: skill_ratings.length });
    }

    // Handle generic section responses (Sections B, D, E)
    if (!section_key || !responses || !Array.isArray(responses)) {
      return res.status(400).json({ error: "section_key and responses[] are required" });
    }

    for (const item of responses) {
      const { error } = await supabase.from("survey_responses").upsert(
        {
          respondent_id: respondentId,
          section_key,
          question_key: item.question_key,
          response_type: item.response_type,
          response_value: item.response_value,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "respondent_id,section_key,question_key" }
      );
      if (error) {
        console.error("Response upsert error:", error);
      }
    }

    return res.json({ saved: true, section_key, count: responses.length });
  }

  // ---- GET /api/survey/my-responses ----
  if (path === "/survey/my-responses" && req.method === "GET") {
    const respondentId = surveyAuth.respondent_id;

    const [{ data: respondent }, { data: responses }, { data: skillRatings }] = await Promise.all([
      supabase.from("survey_respondents")
        .select("full_name, company_name, designation, industry, company_size, years_of_experience, location_city, location_country")
        .eq("id", respondentId).single(),
      supabase.from("survey_responses").select("*").eq("respondent_id", respondentId),
      supabase.from("survey_skill_ratings").select("*").eq("respondent_id", respondentId),
    ]);

    return res.json({ profile: respondent, responses: responses || [], skill_ratings: skillRatings || [] });
  }

  // ---- GET /api/survey/results (admin-only via main app auth) ----
  if (path === "/survey/results" && req.method === "GET") {
    // For admin results, also check main app auth
    const mainAuth = await verifyAuth(req);
    if (!mainAuth.authenticated) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const [{ data: respondents, count }, { data: allResponses }, { data: allRatings }] = await Promise.all([
      supabase.from("survey_respondents").select("id, email, full_name, company_name, industry, created_at", { count: "exact" }),
      supabase.from("survey_responses").select("*"),
      supabase.from("survey_skill_ratings").select("*"),
    ]);

    // Compute skill averages
    const skillAverages: Record<string, { importance_avg: number; demonstration_avg: number; count: number }> = {};
    for (const r of allRatings || []) {
      if (!skillAverages[r.skill_name]) {
        skillAverages[r.skill_name] = { importance_avg: 0, demonstration_avg: 0, count: 0 };
      }
      const sa = skillAverages[r.skill_name];
      sa.importance_avg += r.importance_rating || 0;
      sa.demonstration_avg += r.demonstration_rating || 0;
      sa.count++;
    }
    for (const name of Object.keys(skillAverages)) {
      const sa = skillAverages[name];
      sa.importance_avg = Math.round((sa.importance_avg / sa.count) * 10) / 10;
      sa.demonstration_avg = Math.round((sa.demonstration_avg / sa.count) * 10) / 10;
    }

    return res.json({
      total_respondents: count || 0,
      respondents: respondents || [],
      responses: allResponses || [],
      skill_averages: skillAverages,
    });
  }

  return res.status(404).json({ error: "Survey endpoint not found", path });
}

// ==================== ADMIN SURVEY ROUTES (post-auth) ====================

const ADMIN_SURVEY_SECTIONS = ["profile", "hiring_overview", "skill_ratings", "gap_analysis", "emerging_trends"];

function determineSurveyStatus(respondent: any, responseSectionKeys: string[]): string {
    const uniqueSections = [...new Set(responseSectionKeys)];
    if (uniqueSections.length >= 5) return "completed";
    if (uniqueSections.length > 0) return "started";
    if (respondent.last_login_at) return "registered";
    return "invited";
}

export async function handleSurveyAdminRoutes(path: string, req: VercelRequest, res: VercelResponse, auth: AuthResult): Promise<VercelResponse | undefined> {
    // GET /api/admin/survey/dashboard
    if (path === "/admin/survey/dashboard" && req.method === "GET") {
      const [
        { data: respondents },
        { data: allResponses },
        { data: allRatings },
      ] = await Promise.all([
        supabase.from("survey_respondents").select("*"),
        supabase.from("survey_responses").select("respondent_id, section_key"),
        supabase.from("survey_skill_ratings").select("respondent_id, skill_name, importance_rating, demonstration_rating"),
      ]);

      const respList = respondents || [];
      const responseList = allResponses || [];
      const ratingList = allRatings || [];

      // Build per-respondent section sets
      const respondentSections: Record<string, Set<string>> = {};
      for (const r of responseList) {
        if (!respondentSections[r.respondent_id]) respondentSections[r.respondent_id] = new Set();
        respondentSections[r.respondent_id].add(r.section_key);
      }
      // Profile section: check if respondent has full_name set
      for (const resp of respList) {
        if (resp.full_name) {
          if (!respondentSections[resp.id]) respondentSections[resp.id] = new Set();
          respondentSections[resp.id].add("profile");
        }
      }

      let totalInvited = 0, totalRegistered = 0, totalStarted = 0, totalCompleted = 0;
      for (const resp of respList) {
        const sections = respondentSections[resp.id] ? [...respondentSections[resp.id]] : [];
        const status = determineSurveyStatus(resp, sections);
        totalInvited++;
        if (status === "registered" || status === "started" || status === "completed") totalRegistered++;
        if (status === "started" || status === "completed") totalStarted++;
        if (status === "completed") totalCompleted++;
      }

      // Sections completion counts
      const sectionsCompletion: Record<string, number> = {};
      for (const section of ADMIN_SURVEY_SECTIONS) {
        sectionsCompletion[section] = 0;
      }
      for (const respId of Object.keys(respondentSections)) {
        for (const section of respondentSections[respId]) {
          if (sectionsCompletion[section] !== undefined) sectionsCompletion[section]++;
        }
      }

      // Responses by industry and company size
      const industryCounts: Record<string, number> = {};
      const companySizeCounts: Record<string, number> = {};
      for (const resp of respList) {
        if (resp.industry) industryCounts[resp.industry] = (industryCounts[resp.industry] || 0) + 1;
        if (resp.company_size) companySizeCounts[resp.company_size] = (companySizeCounts[resp.company_size] || 0) + 1;
      }

      // Skill ratings summary
      const skillAggs: Record<string, { impSum: number; demSum: number; count: number }> = {};
      for (const r of ratingList) {
        if (!skillAggs[r.skill_name]) skillAggs[r.skill_name] = { impSum: 0, demSum: 0, count: 0 };
        skillAggs[r.skill_name].impSum += r.importance_rating || 0;
        skillAggs[r.skill_name].demSum += r.demonstration_rating || 0;
        skillAggs[r.skill_name].count++;
      }
      const skillEntries = Object.entries(skillAggs).map(([skill, agg]) => ({
        skill,
        importance: Math.round((agg.impSum / agg.count) * 10) / 10,
        demonstration: Math.round((agg.demSum / agg.count) * 10) / 10,
        gap: Math.round(((agg.impSum - agg.demSum) / agg.count) * 10) / 10,
      }));
      const topImportance = [...skillEntries].sort((a, b) => b.importance - a.importance).slice(0, 10);
      const topGap = [...skillEntries].sort((a, b) => b.gap - a.gap).slice(0, 10);

      return res.json({
        total_invited: totalInvited,
        total_registered: totalRegistered,
        total_started: totalStarted,
        total_completed: totalCompleted,
        completion_rate: totalInvited > 0 ? Math.round((totalCompleted / totalInvited) * 1000) / 10 : 0,
        sections_completion: sectionsCompletion,
        responses_by_industry: Object.entries(industryCounts).map(([industry, count]) => ({ industry, count })).sort((a, b) => b.count - a.count),
        responses_by_company_size: Object.entries(companySizeCounts).map(([company_size, count]) => ({ company_size, count })).sort((a, b) => b.count - a.count),
        skill_ratings_summary: {
          top_importance: topImportance.map(s => ({ skill: s.skill, avg: s.importance })),
          top_gap: topGap.map(s => ({ skill: s.skill, gap: s.gap })),
          total_skills_rated: ratingList.length,
        },
      });
    }

    // GET /api/admin/survey/respondents
    if (path === "/admin/survey/respondents" && req.method === "GET") {
      const { page = "1", limit = "20", status: filterStatus, search } = req.query as Record<string, string>;
      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);

      const [{ data: respondents }, { data: allResponses }, { data: allRatings }] = await Promise.all([
        supabase.from("survey_respondents").select("*").order("created_at", { ascending: false }),
        supabase.from("survey_responses").select("respondent_id, section_key"),
        supabase.from("survey_skill_ratings").select("respondent_id"),
      ]);

      const respList = respondents || [];
      const responseList = allResponses || [];
      const ratingList = allRatings || [];

      // Build per-respondent data
      const respondentSections: Record<string, Set<string>> = {};
      const respondentRatingCounts: Record<string, number> = {};
      for (const r of responseList) {
        if (!respondentSections[r.respondent_id]) respondentSections[r.respondent_id] = new Set();
        respondentSections[r.respondent_id].add(r.section_key);
      }
      for (const r of ratingList) {
        respondentRatingCounts[r.respondent_id] = (respondentRatingCounts[r.respondent_id] || 0) + 1;
      }
      // Profile section check
      for (const resp of respList) {
        if (resp.full_name) {
          if (!respondentSections[resp.id]) respondentSections[resp.id] = new Set();
          respondentSections[resp.id].add("profile");
        }
      }

      let enriched = respList.map((resp: any) => {
        const sections = respondentSections[resp.id] ? [...respondentSections[resp.id]] : [];
        return {
          id: resp.id,
          email: resp.email,
          full_name: resp.full_name,
          company_name: resp.company_name,
          designation: resp.designation,
          industry: resp.industry,
          status: determineSurveyStatus(resp, sections),
          sections_completed: sections,
          skills_rated: respondentRatingCounts[resp.id] || 0,
          created_at: resp.created_at,
          last_login_at: resp.last_login_at,
        };
      });

      // Apply search filter
      if (search) {
        const s = search.toLowerCase();
        enriched = enriched.filter((r: any) =>
          (r.email && r.email.toLowerCase().includes(s)) ||
          (r.full_name && r.full_name.toLowerCase().includes(s)) ||
          (r.company_name && r.company_name.toLowerCase().includes(s))
        );
      }

      // Apply status filter
      if (filterStatus && filterStatus !== "all") {
        enriched = enriched.filter((r: any) => r.status === filterStatus);
      }

      const total = enriched.length;
      const offset = (pageNum - 1) * limitNum;
      const paginated = enriched.slice(offset, offset + limitNum);

      return res.json({ respondents: paginated, total, page: pageNum });
    }

    // GET /api/admin/survey/respondent/:id
    if (path.match(/^\/admin\/survey\/respondent\/[^/]+$/) && req.method === "GET") {
      const id = path.split("/").pop()!;

      const [{ data: respondent, error: rErr }, { data: responses }, { data: ratings }] = await Promise.all([
        supabase.from("survey_respondents").select("*").eq("id", id).single(),
        supabase.from("survey_responses").select("*").eq("respondent_id", id).order("section_key"),
        supabase.from("survey_skill_ratings").select("*").eq("respondent_id", id).order("skill_name"),
      ]);

      if (rErr || !respondent) return res.status(404).json({ error: "Respondent not found" });

      return res.json({
        respondent,
        responses: responses || [],
        skill_ratings: ratings || [],
      });
    }

    // POST /api/admin/survey/invite
    if (path === "/admin/survey/invite" && req.method === "POST") {
      if (!requirePermission("surveys", "write")(auth, res)) return;
      const { emails } = req.body || {};
      if (!emails || !Array.isArray(emails) || emails.length === 0) {
        return res.status(400).json({ error: "emails array is required" });
      }

      const results: Array<{ email: string; status: string; error?: string }> = [];

      for (const rawEmail of emails) {
        const email = (rawEmail as string).toLowerCase().trim();
        if (!email || !email.includes("@")) {
          results.push({ email: rawEmail, status: "failed", error: "Invalid email" });
          continue;
        }

        try {
          // Upsert respondent record
          const { error: upsertErr } = await supabase
            .from("survey_respondents")
            .upsert({ email }, { onConflict: "email" });

          if (upsertErr) {
            results.push({ email, status: "failed", error: upsertErr.message });
            continue;
          }

          // Try sending invite via Supabase Auth magic link
          let emailSent = false;
          try {
            const { error: linkErr } = await supabase.auth.admin.generateLink({
              type: "magiclink",
              email,
            });
            if (!linkErr) emailSent = true;
          } catch {
            // generateLink not available or failed
          }

          // Fallback: try signInWithOtp via service role
          if (!emailSent && RESEND_API_KEY) {
            try {
              const otp = generateSecureOtp(6);
              const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
              const hashedOtp = await bcrypt.hash(otp, 10);
              await supabase.from("survey_respondents").update({
                auth_otp: hashedOtp,
                auth_otp_expires: expires,
              }).eq("email", email);

              await fetch("https://api.resend.com/emails", {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${RESEND_API_KEY}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  from: process.env.RESEND_FROM_EMAIL || "Nexus Survey <onboarding@resend.dev>",
                  to: [email],
                  subject: "You're invited to the Nexus MBA Skills Survey",
                  text: `You've been invited to participate in the Board Infinity MBA Skills Survey.\n\nYour one-time access code is: ${otp}\n\nAccess the survey at: ${process.env.APP_URL || "https://nexus.boardinfinity.com"}/#/survey\n\nThis code is valid for 15 minutes.`,
                }),
              });
              emailSent = true;
            } catch {
              // email send failed
            }
          }

          results.push({ email, status: emailSent ? "invited" : "added" });
        } catch (err: any) {
          results.push({ email, status: "failed", error: err.message });
        }
      }

      return res.json({
        results,
        total: results.length,
        successful: results.filter(r => r.status !== "failed").length,
        failed: results.filter(r => r.status === "failed").length,
      });
    }

    // POST /api/admin/survey/remind
    if (path === "/admin/survey/remind" && req.method === "POST") {
      if (!requirePermission("surveys", "write")(auth, res)) return;
      const { email } = req.body || {};
      if (!email) return res.status(400).json({ error: "email is required" });

      const normalizedEmail = (email as string).toLowerCase().trim();

      // Generate new OTP and send
      let emailSent = false;
      try {
        const { error: linkErr } = await supabase.auth.admin.generateLink({
          type: "magiclink",
          email: normalizedEmail,
        });
        if (!linkErr) emailSent = true;
      } catch {
        // fallback
      }

      if (!emailSent && RESEND_API_KEY) {
        try {
          const otp = generateSecureOtp(6);
          const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
          const hashedOtp = await bcrypt.hash(otp, 10);
          await supabase.from("survey_respondents").update({
            auth_otp: hashedOtp,
            auth_otp_expires: expires,
          }).eq("email", normalizedEmail);

          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${RESEND_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: process.env.RESEND_FROM_EMAIL || "Nexus Survey <onboarding@resend.dev>",
              to: [normalizedEmail],
              subject: "Reminder: Complete the Nexus MBA Skills Survey",
              text: `This is a reminder to complete the Board Infinity MBA Skills Survey.\n\nYour new one-time access code is: ${otp}\n\nAccess the survey at: ${process.env.APP_URL || "https://nexus.boardinfinity.com"}/#/survey\n\nThis code is valid for 15 minutes.`,
            }),
          });
          emailSent = true;
        } catch {
          // failed
        }
      }

      return res.json({ success: true, email_sent: emailSent });
    }

    // GET /api/admin/survey/analytics
    if (path === "/admin/survey/analytics" && req.method === "GET") {
      const [{ data: allResponses }, { data: allRatings }, { data: respondents }] = await Promise.all([
        supabase.from("survey_responses").select("*"),
        supabase.from("survey_skill_ratings").select("*"),
        supabase.from("survey_respondents").select("*"),
      ]);

      const responseList = allResponses || [];
      const ratingList = allRatings || [];

      // Skill importance vs demonstration
      const skillAggs: Record<string, { impSum: number; demSum: number; count: number }> = {};
      for (const r of ratingList) {
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

      // Hiring patterns from survey responses
      const hiringResponses = responseList.filter((r: any) => r.section_key === "hiring_overview");
      const roleCounts: Record<string, number> = {};
      const rejectionCounts: Record<string, number[]> = {};
      for (const r of hiringResponses) {
        if (r.question_key === "B1" && r.response_value) {
          const roles = Array.isArray(r.response_value) ? r.response_value : (r.response_value as any)?.selected || [];
          for (const role of roles) {
            if (typeof role === "string") roleCounts[role] = (roleCounts[role] || 0) + 1;
          }
        }
        if (r.question_key === "B5" && r.response_value) {
          const rankings = Array.isArray(r.response_value) ? r.response_value : (r.response_value as any)?.rankings || [];
          for (const item of rankings) {
            if (item && typeof item === "object" && item.reason && item.rank) {
              if (!rejectionCounts[item.reason]) rejectionCounts[item.reason] = [];
              rejectionCounts[item.reason].push(item.rank);
            }
          }
        }
      }

      // Gap analysis responses
      const gapResponses = responseList.filter((r: any) => r.section_key === "gap_analysis");
      // Trend responses
      const trendResponses = responseList.filter((r: any) => r.section_key === "emerging_trends");

      return res.json({
        skill_importance_vs_demonstration: skillComparison,
        biggest_gaps: skillComparison.slice(0, 10),
        most_adequate: [...skillComparison].sort((a, b) => a.gap - b.gap).slice(0, 10),
        hiring_patterns: {
          top_roles_hired: Object.entries(roleCounts).map(([role, count]) => ({ role, count })).sort((a, b) => b.count - a.count).slice(0, 15),
          top_rejection_reasons: Object.entries(rejectionCounts).map(([reason, ranks]) => ({
            reason,
            avg_rank: Math.round((ranks.reduce((s, r) => s + r, 0) / ranks.length) * 10) / 10,
            count: ranks.length,
          })).sort((a, b) => a.avg_rank - b.avg_rank),
        },
        gap_analysis_responses: gapResponses,
        trend_responses: trendResponses,
        total_respondents: (respondents || []).length,
        total_ratings: ratingList.length,
        total_responses: responseList.length,
      });
    }
}

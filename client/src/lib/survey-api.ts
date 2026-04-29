// Slug-scoped survey runtime API client.
// All public/respondent endpoints are scoped under /api/survey/:slug/...
// Tokens are stored per slug in localStorage so a respondent can hold sessions
// for multiple surveys simultaneously without collision.

import { authFetch } from "./queryClient";

const API_BASE = "";

function tokenKey(slug: string): string {
  return `nexus_survey_token__${slug}`;
}

export function getSurveyToken(slug: string): string | null {
  return localStorage.getItem(tokenKey(slug));
}

export function setSurveyToken(slug: string, token: string) {
  localStorage.setItem(tokenKey(slug), token);
}

export function clearSurveyToken(slug: string) {
  localStorage.removeItem(tokenKey(slug));
}

export function hasSurveyToken(slug: string): boolean {
  return !!getSurveyToken(slug);
}

async function surveyFetch(slug: string, url: string, init?: RequestInit): Promise<Response> {
  const token = getSurveyToken(slug);
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (init?.body) headers["Content-Type"] = "application/json";
  return fetch(`${API_BASE}${url}`, { ...init, headers });
}

// ==================== Public (pre-auth) ====================

export interface SurveyMeta {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  audience_type: string;
  schema: SurveySchema;
  intro_markdown: string | null;
  thank_you_markdown: string | null;
  estimated_minutes: number | null;
  status: string;
  preview_mode?: boolean;
}

export interface SurveySchema {
  sections: SurveySection[];
  settings?: Record<string, any>;
}

export interface SurveySection {
  key: string;
  title: string;
  description?: string;
  questions: SurveyQuestion[];
}

export interface SurveyQuestion {
  key: string;
  type:
    | "text"
    | "long_text"
    | "single_choice"
    | "multi_choice"
    | "scale"
    | "email"
    | "date"
    | "skill_matrix"
    | "matrix_rating"
    | "ranked_list";
  label: string;
  description?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  scale_min?: number;
  scale_max?: number;
  scale_min_label?: string;
  scale_max_label?: string;
  // skill_matrix: pulls from /api/survey/skill-list, optionally filtered to categories
  skill_categories?: string[];
  min_skills?: number;
  // matrix_rating: rows × cols, each cell receives a rating per scale
  rows?: { key: string; label: string }[];
  cols?: { key: string; label: string }[];
  // ranked_list: items to drag-rank
  items?: { key: string; label: string }[];
  // profile_field: store this answer on survey_respondents columns instead of survey_responses
  profile_field?:
    | "full_name"
    | "company_name"
    | "designation"
    | "industry"
    | "company_size"
    | "years_of_experience"
    | "location_city"
    | "location_country";
}

export async function fetchSurveyMeta(slug: string, opts?: { preview?: boolean }): Promise<SurveyMeta> {
  const url = opts?.preview
    ? `${API_BASE}/api/survey/${encodeURIComponent(slug)}?preview=1`
    : `${API_BASE}/api/survey/${encodeURIComponent(slug)}`;
  // When previewing, attach the admin's Supabase Bearer token via authFetch.
  const res = opts?.preview ? await authFetch(url) : await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Survey not found");
  return data;
}

export async function sendOtp(slug: string, email: string) {
  const res = await fetch(`${API_BASE}/api/survey/${encodeURIComponent(slug)}/auth/send-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email.toLowerCase().trim() }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to send OTP");
  return data as { message: string };
}

export async function verifyOtp(slug: string, email: string, otp: string) {
  const res = await fetch(`${API_BASE}/api/survey/${encodeURIComponent(slug)}/auth/verify-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email.toLowerCase().trim(), otp }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Invalid OTP");
  setSurveyToken(slug, data.token);
  return data as { token: string; respondent_id: string; survey_id: string };
}

// ==================== Authenticated ====================

export interface SurveyProgress {
  total_pct: number;
  completed_sections: number;
  total_sections: number;
  [sectionKey: string]: any;
}

export async function fetchProgress(slug: string): Promise<SurveyProgress> {
  const res = await surveyFetch(slug, `/api/survey/${encodeURIComponent(slug)}/progress`);
  if (!res.ok) {
    if (res.status === 401) {
      clearSurveyToken(slug);
      throw new Error("Session expired");
    }
    throw new Error("Failed to fetch progress");
  }
  return res.json();
}

export async function fetchSkillList(
  categories?: string[]
): Promise<Record<string, { id: string; name: string }[]>> {
  const qs = categories?.length ? `?categories=${encodeURIComponent(categories.join(","))}` : "";
  const res = await fetch(`${API_BASE}/api/survey/skill-list${qs}`);
  if (!res.ok) throw new Error("Failed to fetch skill list");
  return res.json();
}

export interface ResponseItem {
  question_key: string;
  response_type: string;
  response_value: any;
}

export interface SkillRating {
  skill_name: string;
  taxonomy_skill_id?: string | null;
  importance_rating?: number | null;
  demonstration_rating?: number | null;
  is_custom_skill?: boolean;
}

export async function saveResponses(
  slug: string,
  body: {
    section_key: string;
    responses?: ResponseItem[];
    profile_patch?: Record<string, any>;
    skill_ratings?: SkillRating[];
  }
) {
  const res = await surveyFetch(slug, `/api/survey/${encodeURIComponent(slug)}/responses`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to save");
  return data;
}

export async function submitSurvey(slug: string) {
  const res = await surveyFetch(slug, `/api/survey/${encodeURIComponent(slug)}/submit`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to submit");
  return data as { submitted: boolean };
}

export async function fetchMyResponses(slug: string) {
  const res = await surveyFetch(slug, `/api/survey/${encodeURIComponent(slug)}/my-responses`);
  if (!res.ok) throw new Error("Failed to fetch responses");
  return res.json();
}

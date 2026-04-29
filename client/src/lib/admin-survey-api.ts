// Admin-side Survey API (post-auth). All requests go through the existing
// Nexus auth (Supabase Bearer token). Used by /survey-admin and the AI generator wizard.

import type { SurveySchema } from "./survey-api";
import { authFetch } from "./queryClient";

export interface AdminSurveyListItem {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  audience_type: string;
  college_id: string | null;
  status: "draft" | "published" | "paused" | "closed" | "archived";
  version: number;
  locked_at: string | null;
  opens_at: string | null;
  closes_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  section_count: number;
  question_count: number;
  respondent_count: number;
  completed_count: number;
}

export interface AdminSurveyDetail extends Omit<AdminSurveyListItem, "section_count" | "question_count" | "respondent_count" | "completed_count"> {
  schema: SurveySchema;
  intro_markdown: string | null;
  thank_you_markdown: string | null;
  estimated_minutes: number | null;
  parent_survey_id?: string | null;
}

async function jsonFetch(url: string, init?: RequestInit) {
  const res = await authFetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

export async function listSurveys(filters: {
  status?: string;
  audience?: string;
  college_id?: string;
} = {}): Promise<{ surveys: AdminSurveyListItem[] }> {
  const qs = new URLSearchParams();
  if (filters.status) qs.set("status", filters.status);
  if (filters.audience) qs.set("audience", filters.audience);
  if (filters.college_id) qs.set("college_id", filters.college_id);
  const url = `/api/admin/surveys${qs.toString() ? "?" + qs.toString() : ""}`;
  return jsonFetch(url);
}

export async function getSurvey(id: string): Promise<{ survey: AdminSurveyDetail }> {
  return jsonFetch(`/api/admin/surveys/${encodeURIComponent(id)}`);
}

export async function createSurvey(body: {
  title: string;
  slug?: string;
  description?: string;
  audience_type: string;
  college_id?: string | null;
  schema?: SurveySchema;
  intro_markdown?: string;
  thank_you_markdown?: string;
  estimated_minutes?: number | null;
}): Promise<{ survey: AdminSurveyDetail }> {
  return jsonFetch(`/api/admin/surveys`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateSurvey(id: string, patch: Partial<AdminSurveyDetail>): Promise<{ survey: AdminSurveyDetail }> {
  return jsonFetch(`/api/admin/surveys/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function cloneSurvey(id: string, body: {
  title?: string;
  slug?: string;
  audience_type?: string;
  college_id?: string | null;
} = {}): Promise<{ survey: AdminSurveyDetail }> {
  return jsonFetch(`/api/admin/surveys/${encodeURIComponent(id)}/clone`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ==================== AI generator ====================

export interface GeneratedSurveyDraft {
  schema: SurveySchema;
  suggested_title: string;
  suggested_description: string;
  estimated_minutes: number | null;
  source: "brief" | "doc" | "clone";
}

export async function generateSurvey(input: {
  mode: "brief" | "doc" | "clone";
  audience_type: string;
  brief?: string;
  doc_text?: string;
  source_survey_id?: string;
}): Promise<GeneratedSurveyDraft> {
  return jsonFetch(`/api/admin/surveys/generate`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function parseDoc(file: File): Promise<{ text: string; length: number }> {
  // Send as JSON with base64 to avoid relying on Vercel's multipart parsing.
  const buf = await file.arrayBuffer();
  const b64 = arrayBufferToBase64(buf);
  return jsonFetch(`/api/admin/surveys/parse-doc`, {
    method: "POST",
    body: JSON.stringify({ filename: file.name, content_base64: b64 }),
  });
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk) as unknown as number[]);
  }
  return btoa(binary);
}

// ==================== Dashboard / Invites / Respondents / Analytics ====================

export interface SurveyDashboard {
  total_invited: number;
  total_respondents: number;
  total_registered: number;
  total_completed: number;
  completion_rate: number;
  sections_completion: Record<string, number>;
  total_skills_rated: number;
  responses_by_industry: { name: string; count: number }[];
  responses_by_company_size: { name: string; count: number }[];
  invite_counts: Record<string, number>;
}

export async function getDashboard(id: string): Promise<SurveyDashboard> {
  return jsonFetch(`/api/admin/surveys/${encodeURIComponent(id)}/dashboard`);
}

export interface SurveyInvite {
  id: string;
  survey_id: string;
  email: string;
  status: "pending" | "sent" | "opened" | "started" | "completed" | "failed";
  invited_by: string | null;
  invite_sent_at: string | null;
  last_reminder_at: string | null;
  reminder_count: number | null;
  bounced_reason: string | null;
  created_at: string;
  updated_at: string;
}

export async function listInvites(surveyId: string): Promise<{ invites: SurveyInvite[] }> {
  return jsonFetch(`/api/admin/surveys/${encodeURIComponent(surveyId)}/invites`);
}

export interface BulkInviteResult {
  results: { email: string; status: string; error?: string }[];
  total: number;
  successful: number;
  failed: number;
}

export async function addInvites(
  surveyId: string,
  emails: string[],
  send_now = true
): Promise<BulkInviteResult> {
  return jsonFetch(`/api/admin/surveys/${encodeURIComponent(surveyId)}/invites`, {
    method: "POST",
    body: JSON.stringify({ emails, send_now }),
  });
}

export async function sendReminder(surveyId: string, email: string): Promise<{ success: boolean; error?: string }> {
  return jsonFetch(`/api/admin/surveys/${encodeURIComponent(surveyId)}/remind`, {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export interface RespondentRow {
  id: string;
  email: string;
  full_name: string | null;
  company_name: string | null;
  designation: string | null;
  industry: string | null;
  status: "invited" | "registered" | "started" | "completed";
  sections_completed: string[];
  skills_rated: number;
  created_at: string;
  last_login_at: string | null;
}

export async function listRespondents(
  surveyId: string,
  filters: { page?: number; limit?: number; status?: string; search?: string } = {}
): Promise<{ respondents: RespondentRow[]; total: number; page: number }> {
  const qs = new URLSearchParams();
  if (filters.page) qs.set("page", String(filters.page));
  if (filters.limit) qs.set("limit", String(filters.limit));
  if (filters.status && filters.status !== "all") qs.set("status", filters.status);
  if (filters.search) qs.set("search", filters.search);
  const url = `/api/admin/surveys/${encodeURIComponent(surveyId)}/respondents${qs.toString() ? "?" + qs.toString() : ""}`;
  return jsonFetch(url);
}

export interface RespondentDetail {
  respondent: any;
  responses: { section_key: string; question_key: string; response_type: string; response_value: any }[];
  skill_ratings: { skill_name: string; importance_rating: number | null; demonstration_rating: number | null; is_custom_skill: boolean }[];
}

export async function getRespondent(surveyId: string, respondentId: string): Promise<RespondentDetail> {
  return jsonFetch(`/api/admin/surveys/${encodeURIComponent(surveyId)}/respondents/${encodeURIComponent(respondentId)}`);
}

export interface SurveyAnalytics {
  total_respondents: number;
  total_responses: number;
  total_ratings: number;
  skill_comparison: { skill: string; importance: number; demonstration: number; gap: number; respondent_count: number }[];
  biggest_gaps: { skill: string; importance: number; demonstration: number; gap: number; respondent_count: number }[];
  most_adequate: { skill: string; importance: number; demonstration: number; gap: number; respondent_count: number }[];
  response_aggregations: Record<string, Record<string, number>>;
}

export async function getAnalytics(id: string): Promise<SurveyAnalytics> {
  return jsonFetch(`/api/admin/surveys/${encodeURIComponent(id)}/analytics`);
}

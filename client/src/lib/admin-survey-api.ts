// Admin-side Survey API (post-auth). All requests go through the existing
// Nexus auth (cookies/session). Used by /survey-admin and the AI generator wizard.

import type { SurveySchema } from "./survey-api";

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
  const res = await fetch(url, {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
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

const API_BASE = "";

function getSurveyToken(): string | null {
  return localStorage.getItem("nexus_survey_token");
}

export function setSurveyToken(token: string) {
  localStorage.setItem("nexus_survey_token", token);
}

export function clearSurveyToken() {
  localStorage.removeItem("nexus_survey_token");
}

export function hasSurveyToken(): boolean {
  return !!getSurveyToken();
}

async function surveyFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = getSurveyToken();
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string>),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  if (init?.body) {
    headers["Content-Type"] = "application/json";
  }
  return fetch(`${API_BASE}${url}`, { ...init, headers });
}

export async function sendOtp(email: string) {
  const res = await surveyFetch("/api/survey/auth/send-otp", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to send OTP");
  return data;
}

export async function verifyOtp(email: string, otp: string) {
  const res = await surveyFetch("/api/survey/auth/verify-otp", {
    method: "POST",
    body: JSON.stringify({ email, otp }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Verification failed");
  return data as { token: string; respondent_id: string };
}

export async function fetchProgress() {
  const res = await surveyFetch("/api/survey/progress");
  if (!res.ok) {
    if (res.status === 401) {
      clearSurveyToken();
      throw new Error("Session expired");
    }
    throw new Error("Failed to fetch progress");
  }
  return res.json();
}

export async function fetchSkillList(): Promise<Record<string, { id: string; name: string }[]>> {
  const res = await surveyFetch("/api/survey/skill-list");
  if (!res.ok) throw new Error("Failed to fetch skill list");
  return res.json();
}

export async function saveResponses(body: {
  section_key: string;
  responses?: { question_key: string; response_type: string; response_value: any }[];
  profile?: Record<string, any>;
  skill_ratings?: any[];
}) {
  const res = await surveyFetch("/api/survey/responses", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to save");
  return data;
}

export async function fetchMyResponses() {
  const res = await surveyFetch("/api/survey/my-responses");
  if (!res.ok) throw new Error("Failed to fetch responses");
  return res.json();
}

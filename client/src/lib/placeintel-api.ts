const API_BASE = "";

function getPlaceIntelToken(): string | null {
  return localStorage.getItem("nexus_placeintel_token");
}

export function setPlaceIntelToken(token: string) {
  localStorage.setItem("nexus_placeintel_token", token);
}

export function clearPlaceIntelToken() {
  localStorage.removeItem("nexus_placeintel_token");
  localStorage.removeItem("nexus_placeintel_respondent_id");
  localStorage.removeItem("nexus_placeintel_college_id");
}

export function hasPlaceIntelToken(): boolean {
  return !!getPlaceIntelToken();
}

export function getStoredCollegeId(): string | null {
  return localStorage.getItem("nexus_placeintel_college_id");
}

async function piFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = getPlaceIntelToken();
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

// Auth
export async function requestOtp(email: string, collegeId: string): Promise<{ success: boolean; domain_verified: boolean }> {
  const res = await fetch(`${API_BASE}/api/placeintel/auth/request-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email.toLowerCase().trim(), college_id: collegeId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to send OTP");
  return data;
}

export async function verifyOtp(email: string, otp: string): Promise<{ token: string; respondent_id: string; college_id: string }> {
  const res = await fetch(`${API_BASE}/api/placeintel/auth/verify-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email.toLowerCase().trim(), otp }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "OTP verification failed");
  return data;
}

// College info (public)
export async function fetchCollegeInfo(collegeId: string) {
  const res = await fetch(`${API_BASE}/api/placeintel/college/${collegeId}`);
  if (!res.ok) throw new Error("College not found");
  return res.json();
}

// Profile
export async function fetchProfile(collegeId: string) {
  const res = await piFetch(`/api/placeintel/profile/${collegeId}`);
  if (res.status === 401) { clearPlaceIntelToken(); throw new Error("Session expired"); }
  if (!res.ok) throw new Error("Failed to fetch profile");
  return res.json();
}

export async function saveProfile(collegeId: string, data: Record<string, any>) {
  const res = await piFetch(`/api/placeintel/profile/${collegeId}`, {
    method: "POST",
    body: JSON.stringify(data),
  });
  const result = await res.json();
  if (!res.ok) throw new Error(result.error || "Failed to save");
  return result;
}

export async function submitProfile(collegeId: string) {
  const res = await piFetch(`/api/placeintel/profile/${collegeId}/submit`, { method: "POST" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to submit");
  return data;
}

// Programs
export async function fetchPrograms(collegeId: string) {
  const res = await piFetch(`/api/placeintel/programs/${collegeId}`);
  if (!res.ok) throw new Error("Failed to fetch programs");
  return res.json();
}

export async function saveProgram(collegeId: string, data: Record<string, any>) {
  const res = await piFetch(`/api/placeintel/programs/${collegeId}`, {
    method: "POST",
    body: JSON.stringify(data),
  });
  const result = await res.json();
  if (!res.ok) throw new Error(result.error || "Failed to save program");
  return result;
}

export async function deleteProgram(programId: string) {
  const res = await piFetch(`/api/placeintel/programs/${programId}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete program");
  return res.json();
}

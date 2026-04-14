import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabase } from "./supabase";

export interface NexusUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  is_active: boolean;
  permissions: Record<string, string> | null;
  restricted_college_ids: string[] | null;
  restricted_regions: string[] | null;
}

export interface AuthResult {
  authenticated: boolean;
  email?: string;
  nexusUser?: NexusUser;
}

export const ALL_SECTIONS = [
  "dashboard", "jobs", "companies", "people", "upload", "pipelines",
  "schedules", "taxonomy", "jd_analyzer", "data_quality", "surveys",
  "colleges", "reports", "placeintel", "masters", "settings", "users",
] as const;

export const ROLE_DEFAULTS: Record<string, Record<string, string>> = {
  super_admin: Object.fromEntries(ALL_SECTIONS.map(s => [s, "full"])),
  admin: Object.fromEntries(ALL_SECTIONS.map(s => [s, s === "users" ? "none" : "full"])),
  editor: {
    dashboard: "read", jobs: "write", companies: "write", people: "write",
    upload: "write", pipelines: "read", schedules: "read", taxonomy: "write",
    jd_analyzer: "read", data_quality: "read", surveys: "read", colleges: "write",
    reports: "write", placeintel: "read", settings: "none", users: "none",
  },
  viewer: {
    dashboard: "read", jobs: "read", companies: "read", people: "read",
    upload: "none", pipelines: "none", schedules: "none", taxonomy: "read",
    jd_analyzer: "read", data_quality: "read", surveys: "read", colleges: "read",
    reports: "read", placeintel: "read", settings: "none", users: "none",
  },
  college_rep: {
    dashboard: "read", jobs: "none", companies: "none", people: "none",
    upload: "none", pipelines: "none", schedules: "none", taxonomy: "none",
    jd_analyzer: "none", data_quality: "none", surveys: "none", colleges: "read",
    reports: "none", placeintel: "read", settings: "none", users: "none",
  },
};

const PERM_HIERARCHY: Record<string, number> = { none: 0, read: 1, write: 2, full: 3 };

export function getResolvedPermissions(user: NexusUser): Record<string, string> {
  if (user.permissions && Object.keys(user.permissions).length > 0) {
    const defaults = ROLE_DEFAULTS[user.role] || ROLE_DEFAULTS.viewer;
    return { ...defaults, ...user.permissions };
  }
  return ROLE_DEFAULTS[user.role] || ROLE_DEFAULTS.viewer;
}

export function hasPermission(user: NexusUser, section: string, level: "read" | "write" | "full"): boolean {
  if (user.role === "super_admin") return true;
  const perms = getResolvedPermissions(user);
  const sectionPerm = perms[section] || "none";
  return (PERM_HIERARCHY[sectionPerm] || 0) >= (PERM_HIERARCHY[level] || 0);
}

export function requirePermission(section: string, level: "read" | "write" | "full") {
  return (auth: AuthResult, res: VercelResponse): boolean => {
    if (!auth.nexusUser || !hasPermission(auth.nexusUser, section, level)) {
      res.status(403).json({ error: "You don't have access to this section" });
      return false;
    }
    return true;
  };
}

export function requireSuperAdmin(auth: AuthResult, res: VercelResponse): boolean {
  if (!auth.nexusUser || auth.nexusUser.role !== "super_admin") {
    res.status(403).json({ error: "Only super admins can access this resource" });
    return false;
  }
  return true;
}

export function requireAdmin(auth: AuthResult, res: VercelResponse): boolean {
  if (!auth.nexusUser || (auth.nexusUser.role !== "super_admin" && auth.nexusUser.role !== "admin")) {
    res.status(403).json({ error: "Admin access required" });
    return false;
  }
  return true;
}

export function requireEditor(auth: AuthResult, section: string, res: VercelResponse): boolean {
  if (!auth.nexusUser || !hasPermission(auth.nexusUser, section, "write")) {
    res.status(403).json({ error: "Insufficient permissions" });
    return false;
  }
  return true;
}

export function requireReader(auth: AuthResult, section: string, res: VercelResponse): boolean {
  if (!auth.nexusUser || !hasPermission(auth.nexusUser, section, "read")) {
    res.status(403).json({ error: "Insufficient permissions" });
    return false;
  }
  return true;
}

export async function verifyAuth(req: VercelRequest): Promise<AuthResult> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return { authenticated: false };
  }
  const token = authHeader.substring(7);
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return { authenticated: false };

    if (!user.email?.endsWith("@boardinfinity.com")) {
      return { authenticated: false };
    }

    const { data: nexusUser, error: lookupErr } = await supabase
      .from("nexus_users")
      .select("id, email, name, role, is_active, permissions, restricted_college_ids, restricted_regions")
      .eq("email", user.email)
      .single();

    if (lookupErr || !nexusUser) {
      return { authenticated: false };
    }

    if (!nexusUser.is_active) {
      return { authenticated: false };
    }

    supabase.from("nexus_users").update({ last_login_at: new Date().toISOString() }).eq("id", nexusUser.id).then(() => {});

    return { authenticated: true, email: user.email, nexusUser: nexusUser as NexusUser };
  } catch {
    return { authenticated: false };
  }
}

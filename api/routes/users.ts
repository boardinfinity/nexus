import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabase } from "../lib/supabase";
import { type AuthResult, type NexusUser, getResolvedPermissions, ROLE_DEFAULTS, requireSuperAdmin } from "../lib/auth";

export async function handleUsersRoutes(path: string, req: VercelRequest, res: VercelResponse, auth: AuthResult): Promise<VercelResponse | undefined> {
  // GET /users/me
  if (path === "/users/me" && req.method === "GET") {
    if (!auth.nexusUser) return res.status(401).json({ error: "Not authenticated" });
    const resolved = getResolvedPermissions(auth.nexusUser);
    return res.json({
      ...auth.nexusUser,
      resolved_permissions: resolved,
      role_defaults: ROLE_DEFAULTS[auth.nexusUser.role] || {},
    });
  }

  // GET /users/role-defaults
  if (path === "/users/role-defaults" && req.method === "GET") {
    return res.json(ROLE_DEFAULTS);
  }

  // GET /users — list all (super_admin only)
  if (path.match(/^\/users\/?$/) && req.method === "GET") {
    if (!requireSuperAdmin(auth, res)) return;
    const { data, error } = await supabase.from("nexus_users").select("*").order("created_at", { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  }

  // POST /users — create (super_admin only)
  if (path.match(/^\/users\/?$/) && req.method === "POST") {
    if (!requireSuperAdmin(auth, res)) return;
    const { email, name, role, permissions, restricted_college_ids, restricted_regions } = req.body || {};
    if (!email) return res.status(400).json({ error: "Email is required" });
    if (!email.endsWith("@boardinfinity.com")) {
      return res.status(400).json({ error: "Only @boardinfinity.com emails can be added" });
    }
    const validRoles = ["admin", "editor", "viewer", "college_rep"];
    if (role && !validRoles.includes(role)) {
      return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(", ")}` });
    }
    const { data, error } = await supabase.from("nexus_users").insert({
      email: email.toLowerCase().trim(),
      name: name || null,
      role: role || "viewer",
      permissions: permissions || null,
      restricted_college_ids: restricted_college_ids || null,
      restricted_regions: restricted_regions || null,
      invited_by: auth.email,
    }).select().single();
    if (error) {
      if (error.code === "23505") return res.status(409).json({ error: "User with this email already exists" });
      return res.status(500).json({ error: error.message });
    }
    return res.status(201).json(data);
  }

  // PATCH /users/:id — update (super_admin only)
  if (path.match(/^\/users\/[^/]+$/) && req.method === "PATCH") {
    if (!requireSuperAdmin(auth, res)) return;
    const userId = path.split("/").pop()!;
    const { name, role, is_active, permissions, restricted_college_ids, restricted_regions } = req.body || {};

    if (userId === auth.nexusUser?.id && role && role !== "super_admin") {
      return res.status(400).json({ error: "Cannot change your own role from super_admin" });
    }

    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    if (name !== undefined) updates.name = name;
    if (role !== undefined) {
      const validRoles = ["super_admin", "admin", "editor", "viewer", "college_rep"];
      if (!validRoles.includes(role)) return res.status(400).json({ error: "Invalid role" });
      updates.role = role;
    }
    if (is_active !== undefined) updates.is_active = is_active;
    if (permissions !== undefined) updates.permissions = permissions;
    if (restricted_college_ids !== undefined) updates.restricted_college_ids = restricted_college_ids;
    if (restricted_regions !== undefined) updates.restricted_regions = restricted_regions;

    const { data, error } = await supabase.from("nexus_users").update(updates).eq("id", userId).select().single();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "User not found" });
    return res.json(data);
  }

  // DELETE /users/:id — deactivate (super_admin only)
  if (path.match(/^\/users\/[^/]+$/) && req.method === "DELETE") {
    if (!requireSuperAdmin(auth, res)) return;
    const userId = path.split("/").pop()!;
    if (userId === auth.nexusUser?.id) {
      return res.status(400).json({ error: "Cannot deactivate your own account" });
    }
    const { data, error } = await supabase.from("nexus_users").update({ is_active: false, updated_at: new Date().toISOString() }).eq("id", userId).select().single();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "User not found" });
    return res.json(data);
  }

  return undefined;
}

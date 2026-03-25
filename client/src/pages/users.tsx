import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { UserPlus, Shield, Pencil, UserX, UserCheck, Loader2, Info, ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface NexusUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  is_active: boolean;
  permissions: Record<string, string> | null;
  restricted_college_ids: string[] | null;
  restricted_regions: string[] | null;
  last_login_at: string | null;
  invited_by: string | null;
  created_at: string;
}

const SECTIONS = [
  { key: "dashboard", label: "Dashboard" },
  { key: "jobs", label: "Jobs" },
  { key: "companies", label: "Companies" },
  { key: "people", label: "People" },
  { key: "upload", label: "Upload" },
  { key: "pipelines", label: "Pipelines" },
  { key: "schedules", label: "Schedules" },
  { key: "taxonomy", label: "Taxonomy" },
  { key: "jd_analyzer", label: "JD Analyzer" },
  { key: "data_quality", label: "Data Quality" },
  { key: "surveys", label: "Surveys" },
  { key: "colleges", label: "Colleges" },
  { key: "reports", label: "Reports" },
  { key: "placeintel", label: "PlaceIntel" },
  { key: "settings", label: "Settings" },
];

const LEVELS = ["none", "read", "write", "full"] as const;

const ROLE_COLORS: Record<string, string> = {
  super_admin: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  admin: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  editor: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  viewer: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
  college_rep: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
};

const ROLE_DESCRIPTIONS: Record<string, string> = {
  admin: "Full access to all features except user management",
  editor: "Read + write on most sections, read-only for pipelines & analytics",
  viewer: "Read-only access across all visible sections",
  college_rep: "Read-only access to colleges and PlaceIntel (can be filtered)",
};

function RoleBadge({ role }: { role: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[role] || ROLE_COLORS.viewer}`}>
      {role.replace("_", " ")}
    </span>
  );
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return "Never";
  return new Date(dateStr).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export default function UsersPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [editUser, setEditUser] = useState<NexusUser | null>(null);

  // Form state for add
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState("viewer");

  // Form state for edit
  const [editRole, setEditRole] = useState("");
  const [editName, setEditName] = useState("");
  const [editPermissions, setEditPermissions] = useState<Record<string, string>>({});
  const [showPermEditor, setShowPermEditor] = useState(false);

  const { data: users, isLoading, isError, refetch } = useQuery<NexusUser[]>({
    queryKey: ["/api/users"],
  });

  const { data: roleDefaults } = useQuery<Record<string, Record<string, string>>>({
    queryKey: ["/api/users/role-defaults"],
  });

  const createUser = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/users", {
        email: newEmail.toLowerCase().trim(),
        name: newName.trim() || null,
        role: newRole,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setAddOpen(false);
      setNewEmail("");
      setNewName("");
      setNewRole("viewer");
      toast({ title: "User created", description: `${newEmail} has been added.` });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateUser = useMutation({
    mutationFn: async ({ id, ...updates }: { id: string } & Record<string, any>) => {
      const res = await apiRequest("PATCH", `/api/users/${id}`, updates);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setEditUser(null);
      toast({ title: "User updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      if (!is_active) {
        // Deactivate via DELETE
        const res = await apiRequest("DELETE", `/api/users/${id}`);
        return res.json();
      }
      // Reactivate via PATCH
      const res = await apiRequest("PATCH", `/api/users/${id}`, { is_active: true });
      return res.json();
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: vars.is_active ? "User reactivated" : "User deactivated" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  function openEdit(user: NexusUser) {
    setEditUser(user);
    setEditRole(user.role);
    setEditName(user.name || "");
    // Compute resolved permissions: custom overrides on top of role defaults
    const defaults = roleDefaults?.[user.role] || {};
    setEditPermissions(user.permissions && Object.keys(user.permissions).length > 0
      ? { ...defaults, ...user.permissions }
      : { ...defaults });
    setShowPermEditor(false);
  }

  function handleSaveEdit() {
    if (!editUser) return;
    const updates: Record<string, any> = { id: editUser.id };
    if (editName !== (editUser.name || "")) updates.name = editName.trim() || null;
    if (editRole !== editUser.role) updates.role = editRole;
    if (showPermEditor) {
      // Only save custom permissions if they differ from role defaults
      const defaults = roleDefaults?.[editRole] || {};
      const customPerms: Record<string, string> = {};
      let hasCustom = false;
      for (const s of SECTIONS) {
        if (editPermissions[s.key] && editPermissions[s.key] !== defaults[s.key]) {
          customPerms[s.key] = editPermissions[s.key];
          hasCustom = true;
        }
      }
      updates.permissions = hasCustom ? customPerms : null;
    }
    updateUser.mutate(updates);
  }

  // When role changes in edit dialog, reset permissions to that role's defaults
  function handleEditRoleChange(role: string) {
    setEditRole(role);
    const defaults = roleDefaults?.[role] || {};
    setEditPermissions({ ...defaults });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Shield className="h-6 w-6" />
            User Management
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage who can access Nexus and what they can do
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <UserPlus className="h-4 w-4 mr-2" />
          Add User
        </Button>
      </div>

      <Collapsible>
        <CollapsibleTrigger className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <Info className="h-3.5 w-3.5" />
          <span>How this works</span>
          <ChevronDown className="h-3.5 w-3.5" />
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-3">
          <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground space-y-2">
            <p><strong>How this works:</strong></p>
            <p>• Every Nexus user needs a @boardinfinity.com email registered here</p>
            <p>• 5 roles: Super Admin (full access), Admin (manage users + all features), Editor (create/edit data), Viewer (read only), College Rep (PlaceIntel only)</p>
            <p>• Permissions are per-section: Jobs, Companies, People, Reports, etc.</p>
            <p className="pt-1"><strong>Role templates:</strong></p>
            <p>• Super Admin — full access to everything including user management</p>
            <p>• Admin — same as Super Admin but can't delete other admins</p>
            <p>• Editor — can run pipelines, upload data, trigger enrichment</p>
            <p>• Viewer — read-only access to all sections</p>
            <p>• College Rep — only sees PlaceIntel and Colleges sections</p>
            <p className="pt-1"><strong>Adding a user:</strong></p>
            <p>1. Click "Add User" and enter their @boardinfinity.com email</p>
            <p>2. Select a role (applies a permission template)</p>
            <p>3. Optionally customize per-section permissions</p>
            <p>4. User can login immediately via OTP</p>
            <p className="pt-1"><strong>Limitations:</strong></p>
            <p>• Only @boardinfinity.com emails can be registered</p>
            <p>• Only Super Admins can add/remove users</p>
            <p>• Deactivated users can't login but their data isn't deleted</p>
          </div>
        </CollapsibleContent>
      </Collapsible>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Team Members ({users?.length || 0})</CardTitle>
        </CardHeader>
        <CardContent>
          {isError ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <p>Failed to load users</p>
              <Button variant="outline" size="sm" onClick={() => refetch()} className="mt-2">Try Again</Button>
            </div>
          ) : isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Login</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users?.map((user) => (
                  <TableRow key={user.id} className={!user.is_active ? "opacity-50" : ""}>
                    <TableCell className="font-medium">{user.name || "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{user.email}</TableCell>
                    <TableCell><RoleBadge role={user.role} /></TableCell>
                    <TableCell>
                      <Badge variant={user.is_active ? "default" : "secondary"}>
                        {user.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(user.last_login_at)}
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      {user.role !== "super_admin" && (
                        <>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(user)} title="Edit">
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => toggleActive.mutate({ id: user.id, is_active: !user.is_active })}
                            title={user.is_active ? "Deactivate" : "Reactivate"}
                          >
                            {user.is_active
                              ? <UserX className="h-3.5 w-3.5 text-destructive" />
                              : <UserCheck className="h-3.5 w-3.5 text-green-600" />}
                          </Button>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add User Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Team Member</DialogTitle>
            <DialogDescription>
              Only @boardinfinity.com emails can be added.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                placeholder="name@boardinfinity.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                placeholder="Full name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={newRole} onValueChange={setNewRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="editor">Editor</SelectItem>
                  <SelectItem value="viewer">Viewer</SelectItem>
                  <SelectItem value="college_rep">College Rep</SelectItem>
                </SelectContent>
              </Select>
              {ROLE_DESCRIPTIONS[newRole] && (
                <p className="text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[newRole]}</p>
              )}
            </div>
            {/* Role template preview */}
            {roleDefaults?.[newRole] && (
              <div className="bg-muted/50 rounded-lg p-3 space-y-1">
                <p className="text-xs font-medium text-muted-foreground mb-2">Default permissions for {newRole.replace("_", " ")}:</p>
                <div className="grid grid-cols-2 gap-1">
                  {SECTIONS.map((s) => {
                    const level = roleDefaults[newRole]?.[s.key] || "none";
                    if (level === "none") return null;
                    return (
                      <div key={s.key} className="flex items-center justify-between text-xs">
                        <span>{s.label}</span>
                        <span className={`font-mono ${level === "full" ? "text-green-600" : level === "write" ? "text-blue-600" : "text-gray-500"}`}>
                          {level}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button
              onClick={() => createUser.mutate()}
              disabled={!newEmail.endsWith("@boardinfinity.com") || createUser.isPending}
            >
              {createUser.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Add User
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={!!editUser} onOpenChange={(open) => { if (!open) setEditUser(null); }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit User — {editUser?.email}</DialogTitle>
            <DialogDescription>
              Change role or customize individual section permissions.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={editRole} onValueChange={handleEditRoleChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="editor">Editor</SelectItem>
                  <SelectItem value="viewer">Viewer</SelectItem>
                  <SelectItem value="college_rep">College Rep</SelectItem>
                </SelectContent>
              </Select>
              {ROLE_DESCRIPTIONS[editRole] && (
                <p className="text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[editRole]}</p>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Switch checked={showPermEditor} onCheckedChange={setShowPermEditor} id="custom-perms" />
              <Label htmlFor="custom-perms" className="text-sm">Customize permissions</Label>
            </div>

            {showPermEditor && (
              <div className="border rounded-lg p-3 space-y-2">
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  Override individual section access levels:
                </p>
                {SECTIONS.map((s) => (
                  <div key={s.key} className="flex items-center justify-between">
                    <span className="text-sm">{s.label}</span>
                    <Select
                      value={editPermissions[s.key] || "none"}
                      onValueChange={(val) => setEditPermissions({ ...editPermissions, [s.key]: val })}
                    >
                      <SelectTrigger className="w-28 h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {LEVELS.map((l) => (
                          <SelectItem key={l} value={l}>{l}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditUser(null)}>Cancel</Button>
            <Button onClick={handleSaveEdit} disabled={updateUser.isPending}>
              {updateUser.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

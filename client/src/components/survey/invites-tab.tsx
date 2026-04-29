import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Send, Mail, RefreshCw, Search, AlertCircle } from "lucide-react";
import {
  addInvites,
  listInvites,
  sendReminder,
  type SurveyInvite,
} from "@/lib/admin-survey-api";

const STATUS_TONE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800 border-amber-200",
  sent: "bg-sky-100 text-sky-800 border-sky-200",
  opened: "bg-indigo-100 text-indigo-800 border-indigo-200",
  started: "bg-violet-100 text-violet-800 border-violet-200",
  completed: "bg-emerald-100 text-emerald-800 border-emerald-200",
  failed: "bg-rose-100 text-rose-800 border-rose-200",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function InvitesTab({
  surveyId,
  surveyTitle,
  canSend,
}: {
  surveyId: string;
  surveyTitle: string;
  canSend: boolean;
}) {
  const { toast } = useToast();
  const [invites, setInvites] = useState<SurveyInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [bulkText, setBulkText] = useState("");
  const [sendNow, setSendNow] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [resendingEmail, setResendingEmail] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  async function reload() {
    try {
      const r = await listInvites(surveyId);
      setInvites(r.invites);
    } catch (err: any) {
      toast({ title: "Failed to load invites", description: err.message, variant: "destructive" });
    }
  }

  useEffect(() => {
    setLoading(true);
    reload().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surveyId]);

  const parsedEmails = useMemo(() => {
    const raw = bulkText
      .split(/[\s,;]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const valid: string[] = [];
    const invalid: string[] = [];
    const seen = new Set<string>();
    for (const e of raw) {
      if (seen.has(e)) continue;
      seen.add(e);
      if (EMAIL_RE.test(e)) valid.push(e);
      else invalid.push(e);
    }
    return { valid, invalid };
  }, [bulkText]);

  async function submitBulk() {
    if (parsedEmails.valid.length === 0) {
      toast({ title: "No valid emails", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const result = await addInvites(surveyId, parsedEmails.valid, sendNow && canSend);
      toast({
        title: `Added ${result.successful} invites`,
        description: result.failed
          ? `${result.failed} failed — see list below`
          : sendNow && canSend
            ? "Emails dispatched"
            : "Saved without sending",
      });
      setBulkText("");
      await reload();
    } catch (err: any) {
      toast({ title: "Bulk add failed", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  async function resend(email: string) {
    setResendingEmail(email);
    try {
      await sendReminder(surveyId, email);
      toast({ title: "Reminder sent", description: email });
      await reload();
    } catch (err: any) {
      toast({ title: "Reminder failed", description: err.message, variant: "destructive" });
    } finally {
      setResendingEmail(null);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return invites;
    return invites.filter((i) => i.email.toLowerCase().includes(q));
  }, [invites, search]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const i of invites) c[i.status] = (c[i.status] || 0) + 1;
    return c;
  }, [invites]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Card className="lg:col-span-1">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Mail className="h-4 w-4" /> Bulk add invitees
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Paste one email per line (or comma-separated). Duplicates and invalid entries are skipped.
          </p>
          <Textarea
            rows={8}
            placeholder="alice@example.com&#10;bob@example.com&#10;carol@example.com"
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            className="font-mono text-xs"
          />
          {(parsedEmails.valid.length > 0 || parsedEmails.invalid.length > 0) && (
            <div className="text-xs text-muted-foreground space-y-1">
              <div>
                <span className="font-medium text-foreground">{parsedEmails.valid.length}</span> valid
                {parsedEmails.invalid.length > 0 && (
                  <>
                    {" · "}
                    <span className="text-rose-600">{parsedEmails.invalid.length} invalid</span>
                  </>
                )}
              </div>
              {parsedEmails.invalid.length > 0 && (
                <div className="text-[10px] font-mono text-rose-600 truncate">
                  {parsedEmails.invalid.slice(0, 3).join(", ")}
                  {parsedEmails.invalid.length > 3 && ` +${parsedEmails.invalid.length - 3}`}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-2">
            <Checkbox
              id="send-now"
              checked={sendNow}
              onCheckedChange={(v) => setSendNow(Boolean(v))}
              disabled={!canSend}
            />
            <label
              htmlFor="send-now"
              className={`text-sm ${!canSend ? "text-muted-foreground" : ""}`}
            >
              Send invite email now
            </label>
          </div>

          {!canSend && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                Survey is not published — invites will be saved as pending. Publish to send.
              </AlertDescription>
            </Alert>
          )}

          <Button
            onClick={submitBulk}
            disabled={submitting || parsedEmails.valid.length === 0}
            className="w-full"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Send className="h-4 w-4 mr-2" />
            )}
            Add {parsedEmails.valid.length || ""} invitees
          </Button>
          <p className="text-[10px] text-muted-foreground">
            Subject line will reference: <span className="font-medium">{surveyTitle}</span>
          </p>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader className="flex-row items-center justify-between space-y-0 gap-2">
          <div>
            <CardTitle className="text-base">Invites</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              {invites.length} total
              {Object.entries(counts).map(([k, v]) => (
                <span key={k} className="ml-2">
                  · {k} {v}
                </span>
              ))}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search email"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-7 h-8 text-xs w-48"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setLoading(true);
                reload().finally(() => setLoading(false));
              }}
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-12">
              {invites.length === 0 ? "No invites yet" : "No matches"}
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead className="w-28">Status</TableHead>
                    <TableHead className="w-32">Sent</TableHead>
                    <TableHead className="w-24 text-center">Reminders</TableHead>
                    <TableHead className="w-24 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell className="font-mono text-xs">
                        {inv.email}
                        {inv.bounced_reason && (
                          <div className="text-[10px] text-rose-600 mt-0.5">{inv.bounced_reason}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-xs ${STATUS_TONE[inv.status] || ""}`}>
                          {inv.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {inv.invite_sent_at
                          ? new Date(inv.invite_sent_at).toLocaleDateString()
                          : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-center">
                        {inv.reminder_count || 0}
                        {inv.last_reminder_at && (
                          <div className="text-[10px] text-muted-foreground">
                            {new Date(inv.last_reminder_at).toLocaleDateString()}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {inv.status !== "completed" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={resendingEmail === inv.email || !canSend}
                            onClick={() => resend(inv.email)}
                          >
                            {resendingEmail === inv.email ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <RefreshCw className="h-3 w-3" />
                            )}
                            <span className="ml-1 text-xs">Remind</span>
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

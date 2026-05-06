// Mandrill mailer (single provider).
// Configure MANDRILL_API_KEY, MANDRILL_FROM_EMAIL, MANDRILL_FROM_NAME in Vercel env.

export const MANDRILL_API_KEY    = process.env.MANDRILL_API_KEY    || "";
export const MANDRILL_FROM_EMAIL = process.env.MANDRILL_FROM_EMAIL || "connect@boardinfinity.com";
export const MANDRILL_FROM_NAME  = process.env.MANDRILL_FROM_NAME  || "Board Infinity";

export interface SendEmailInput {
  to:        string;
  to_name?:  string;
  subject:   string;
  text?:     string;
  html?:     string;
  tags?:     string[];          // for analytics filtering in Mandrill
  metadata?: Record<string, string>;
  from_email?: string;          // override default from
  from_name?:  string;
}

export interface SendEmailResult {
  ok:           boolean;
  provider:     "mandrill" | "none";
  message_id?:  string;
  error?:       string;
  status_code?: number;
}

// ----------------- Mandrill -----------------
async function sendViaMandrill(input: SendEmailInput): Promise<SendEmailResult> {
  if (!MANDRILL_API_KEY) return { ok: false, provider: "mandrill", error: "MANDRILL_API_KEY not configured" };

  const fromEmail = input.from_email || MANDRILL_FROM_EMAIL;
  const fromName  = input.from_name  || MANDRILL_FROM_NAME;

  try {
    const res = await fetch("https://mandrillapp.com/api/1.0/messages/send.json", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: MANDRILL_API_KEY,
        message: {
          from_email:  fromEmail,
          from_name:   fromName,
          to: [{ email: input.to, name: input.to_name, type: "to" }],
          subject:     input.subject,
          text:        input.text,
          html:        input.html,
          tags:        input.tags || ["nexus-survey"],
          metadata:    input.metadata,
          track_opens: true,
          track_clicks: true,
          auto_text:   !input.text && !!input.html,
          auto_html:   !input.html && !!input.text,
        },
        async: false,
      }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      return { ok: false, provider: "mandrill", status_code: res.status, error: typeof body === "object" ? JSON.stringify(body) : String(body) };
    }
    // Mandrill returns an array, one entry per recipient
    const first = Array.isArray(body) ? body[0] : null;
    if (first && (first.status === "sent" || first.status === "queued" || first.status === "scheduled")) {
      return { ok: true, provider: "mandrill", message_id: first._id || first.id };
    }
    return {
      ok: false,
      provider: "mandrill",
      status_code: res.status,
      error: first ? `Mandrill status=${first.status}, reject=${first.reject_reason || "none"}` : "Unknown Mandrill response",
    };
  } catch (err: any) {
    return { ok: false, provider: "mandrill", error: err.message };
  }
}

// ----------------- Public API -----------------
/**
 * Send a single email via Mandrill.
 * Logs the attempt. Never throws — returns a result object.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  if (!MANDRILL_API_KEY) {
    console.warn(`[MAILER] MANDRILL_API_KEY not configured. Email NOT sent. to=${input.to} subject="${input.subject}"`);
    return { ok: false, provider: "none", error: "MANDRILL_API_KEY not configured" };
  }
  const m = await sendViaMandrill(input);
  if (m.ok) {
    console.log(`[MAILER] mandrill sent to=${input.to} subject="${input.subject}" id=${m.message_id}`);
  } else {
    console.error(`[MAILER] mandrill failed to=${input.to}: ${m.error}`);
  }
  return m;
}

/**
 * Send multiple emails with concurrency control. Returns per-email results.
 * Used by /admin/survey/invite (bulk send) — Mandrill handles the actual delivery throughput;
 * we batch HTTP calls to keep memory steady on Vercel serverless.
 */
export async function sendEmailsBatch(
  inputs: SendEmailInput[],
  opts: { concurrency?: number } = {}
): Promise<SendEmailResult[]> {
  const concurrency = Math.max(1, Math.min(opts.concurrency || 10, 25));
  const results: SendEmailResult[] = new Array(inputs.length);
  let next = 0;

  async function worker() {
    while (true) {
      const idx = next++;
      if (idx >= inputs.length) return;
      results[idx] = await sendEmail(inputs[idx]);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

/** Lightweight HTML wrapper used for survey invite/reminder/OTP emails. */
export function basicHtmlTemplate(opts: { title: string; body_html: string; cta_label?: string; cta_url?: string; footer_html?: string }): string {
  const { title, body_html, cta_label, cta_url, footer_html } = opts;
  const cta = cta_label && cta_url
    ? `<p style="margin:32px 0;"><a href="${cta_url}" style="background:#111827;color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;display:inline-block;font-weight:600;">${cta_label}</a></p>`
    : "";
  return `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;background:#f9fafb;margin:0;padding:24px;">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:32px;">
<h2 style="margin:0 0 16px;font-size:20px;">${title}</h2>
<div style="font-size:15px;line-height:1.6;color:#374151;">${body_html}</div>
${cta}
${footer_html ? `<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;"><div style="font-size:12px;color:#6b7280;">${footer_html}</div>` : ""}
</div></body></html>`;
}

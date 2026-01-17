import nodemailer from "nodemailer";
import { getEmailConfigExplicit, isValidSingleEmail } from "./bookingNotify.server";

type UnknownRecord = Record<string, unknown>;

export type AiAssistantEmailRequestBody = {
  // Theme override (preferred) or will fallback to tenant config.
  bookingEmailTo?: string;
  // Human-readable trip summary built client-side (no contact details).
  tripSummaryText?: string;
  // Short conversation transcript.
  messages?: Array<{ role: "user" | "assistant"; content: string }>;
  // Optional page url (useful for context).
  sourceUrl?: string;
  // Sanitized context object (from buildAiAssistantContext)
  context?: UnknownRecord;
};

function clampString(value: unknown, maxLen: number) {
  if (typeof value !== "string") return "";
  const v = value.trim();
  if (!v) return "";
  return v.length > maxLen ? v.slice(0, maxLen) : v;
}

export function validateAiAssistantEmailBody(raw: unknown) {
  const obj = (raw && typeof raw === "object" ? (raw as UnknownRecord) : null) as UnknownRecord | null;
  if (!obj) return { ok: false as const, error: "INVALID_JSON" as const };

  const bookingEmailTo = clampString(obj.bookingEmailTo, 180);
  const tripSummaryText = clampString(obj.tripSummaryText, 2500);
  const sourceUrl = clampString(obj.sourceUrl, 600);

  const messagesRaw = Array.isArray(obj.messages) ? obj.messages : [];
  const messages = messagesRaw
    .map((m) => {
      const mm = (m && typeof m === "object" ? (m as UnknownRecord) : {}) as UnknownRecord;
      const role = mm.role === "assistant" ? "assistant" : mm.role === "user" ? "user" : null;
      const content = clampString(mm.content, 900);
      if (!role || !content) return null;
      return { role, content } as const;
    })
    .filter((m): m is { role: "user" | "assistant"; content: string } => !!m)
    .slice(0, 14);

  const context = obj.context && typeof obj.context === "object" ? (obj.context as UnknownRecord) : undefined;

  // Require some content to avoid empty/spam emails.
  if (!tripSummaryText && !messages.length) {
    return { ok: false as const, error: "EMPTY" as const };
  }

  return {
    ok: true as const,
    value: {
      bookingEmailTo: bookingEmailTo || undefined,
      tripSummaryText: tripSummaryText || undefined,
      messages,
      sourceUrl: sourceUrl || undefined,
      context,
    } satisfies AiAssistantEmailRequestBody,
  };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildAiAssistantLeadEmail(body: AiAssistantEmailRequestBody) {
  const lines: string[] = [];
  lines.push("Demande VTC — Assistant IA");
  lines.push("");

  if (body.sourceUrl) {
    lines.push(`Page: ${body.sourceUrl}`);
    lines.push("");
  }

  if (body.tripSummaryText) {
    lines.push("Résumé trajet:");
    lines.push(body.tripSummaryText);
    lines.push("");
  }

  if (body.messages?.length) {
    lines.push("Conversation:");
    body.messages.forEach((m) => {
      const prefix = m.role === "user" ? "Client" : "Assistant";
      lines.push(`${prefix}: ${m.content}`);
    });
    lines.push("");
  }

  const subject = "Demande VTC — Résumé Assistant IA";
  const text = lines.join("\n").trim();

  const htmlParts: string[] = [];
  htmlParts.push("<h2>Demande VTC — Assistant IA</h2>");

  if (body.sourceUrl) {
    const url = escapeHtml(body.sourceUrl);
    htmlParts.push(`<p><strong>Page:</strong> <a href=\"${url}\" target=\"_blank\" rel=\"noopener noreferrer\">${url}</a></p>`);
  }

  if (body.tripSummaryText) {
    htmlParts.push("<h3>Résumé trajet</h3>");
    htmlParts.push(`<pre style=\"white-space:pre-wrap;line-height:1.4\">${escapeHtml(body.tripSummaryText)}</pre>`);
  }

  if (body.messages?.length) {
    htmlParts.push("<h3>Conversation</h3>");
    htmlParts.push("<div>");
    body.messages.forEach((m) => {
      const who = m.role === "user" ? "Client" : "Assistant";
      htmlParts.push(
        `<p><strong>${escapeHtml(who)}:</strong><br/>${escapeHtml(m.content).replace(/\n/g, "<br/>")}</p>`,
      );
    });
    htmlParts.push("</div>");
  }

  htmlParts.push(
    "<hr/><p style=\"font-size:12px;color:#6b7280\">Note: ce message est un résumé généré depuis le widget. Aucune disponibilité n’est garantie.</p>",
  );

  return { subject, text, html: htmlParts.join("") };
}

export async function sendAiAssistantLeadEmailTo(to: string, body: AiAssistantEmailRequestBody) {
  const trimmedTo = String(to || "").trim();
  if (!isValidSingleEmail(trimmedTo)) {
    return { ok: false as const, error: "EMAIL_TO_INVALID" as const };
  }

  const emailConfig = getEmailConfigExplicit(trimmedTo);
  if (!emailConfig.configured) {
    return {
      ok: false as const,
      error: "EMAIL_NOT_CONFIGURED" as const,
      missing: emailConfig.missing,
    };
  }

  const lead = buildAiAssistantLeadEmail(body);

  const transporter = nodemailer.createTransport({
    host: emailConfig.host,
    port: emailConfig.port,
    secure: emailConfig.secure,
    auth: { user: emailConfig.user, pass: emailConfig.pass },
  });

  await transporter.sendMail({
    from: emailConfig.from,
    to: emailConfig.to,
    subject: lead.subject,
    text: lead.text,
    html: lead.html,
  });

  return { ok: true as const };
}

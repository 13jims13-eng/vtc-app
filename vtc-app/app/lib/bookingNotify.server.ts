import nodemailer from "nodemailer";

export type BookingNotifyRequestBody = {
  contact?: {
    name?: string;
    email?: string;
    phone?: string;
  };
  trip?: {
    start?: string;
    end?: string;
    stops?: unknown[];
    waypoints?: unknown[];
    pickupDate?: string;
    pickupTime?: string;
    vehicle?: string;
    vehicleLabel?: string;
    isQuote?: boolean;
    petOption?: boolean;
    babySeatOption?: boolean;
    options?: unknown[];
    optionsTotalFee?: number;
    customOption?: string;
    price?: number;
    pricingMode?: string;
    leadTimeThresholdMinutes?: number | null;
    surchargesApplied?: unknown;
    distanceKm?: number;
    durationMinutes?: number;
  };
  consents?: {
    termsConsent?: boolean;
    marketingConsent?: boolean;
  };
  config?: {
    bookingEmailTo?: string;
    slackEnabled?: boolean;
    slackDestination?: string;
  };
};

export type BookingSummary = {
  start: string;
  end: string;
  pickupDate: string;
  pickupTime: string;
  vehicle: string;
  stops: string[];
  isQuote: boolean;
  price: number | null;
  pricingMode?: string | null;
  leadTimeThresholdMinutes?: number | null;
  surchargesApplied?: unknown;
  distanceKm: number | null;
  durationMinutes: number | null;
  name: string;
  email: string;
  phone: string;
  termsConsent: boolean;
  marketingConsent: boolean;
  text: string;
  html: string;
  bookingEmailToOverride?: string;
};

export function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function parseBooleanEnv(value: unknown) {
  const v = String(value ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function isValidSingleEmail(value: string) {
  const v = value.trim();
  if (!v) return false;
  // Block newline/header injection and lists.
  if (/[\r\n,;]/.test(v)) return false;
  // Very light validation (storefront already validates).
  return /^\S+@\S+\.\S+$/.test(v);
}

export function validateSlackWebhookUrl(value: string):
  | { ok: true; normalized: string }
  | { ok: false; reason: "EMPTY" | "NOT_HTTPS" | "INVALID_URL" | "INVALID_PREFIX" } {
  const v = value.trim();
  if (!v) return { ok: false, reason: "EMPTY" };

  let url: URL;
  try {
    url = new URL(v);
  } catch {
    return { ok: false, reason: "INVALID_URL" };
  }

  if (url.protocol !== "https:") return { ok: false, reason: "NOT_HTTPS" };
  if (!v.startsWith("https://hooks.slack.com/services/")) {
    return { ok: false, reason: "INVALID_PREFIX" };
  }

  return { ok: true, normalized: v };
}

export function buildBookingSummary(body: BookingNotifyRequestBody): BookingSummary {
  const contact = body?.contact || {};
  const trip = body?.trip || {};
  const consents = body?.consents || {};

  const start = cleanText(trip?.start);
  const end = cleanText(trip?.end);
  const pickupDate = cleanText(trip?.pickupDate);
  const pickupTime = cleanText(trip?.pickupTime);
  const vehicle = cleanText(trip?.vehicle);
  const vehicleLabel = cleanText(trip?.vehicleLabel);

  const stopsRaw = Array.isArray(trip?.stops)
    ? trip.stops
    : Array.isArray(trip?.waypoints)
      ? trip.waypoints
      : [];

  const stops: string[] = stopsRaw.map((s) => cleanText(s)).filter(Boolean);

  const isQuote = vehicle === "autre" || !!trip?.isQuote;
  const price = typeof trip?.price === "number" ? trip.price : null;

  const pricingModeRaw = cleanText((trip as { pricingMode?: unknown })?.pricingMode);
  const pricingMode = pricingModeRaw || null;
  const leadTimeThresholdMinutes =
    typeof (trip as { leadTimeThresholdMinutes?: unknown })?.leadTimeThresholdMinutes === "number"
      ? ((trip as { leadTimeThresholdMinutes: number }).leadTimeThresholdMinutes ?? null)
      : null;
  const surchargesApplied = (trip as { surchargesApplied?: unknown })?.surchargesApplied ?? null;

  const distanceKm = typeof trip?.distanceKm === "number" ? trip.distanceKm : null;
  const durationMinutes = typeof trip?.durationMinutes === "number" ? trip.durationMinutes : null;

  const name = cleanText(contact?.name);
  const email = cleanText(contact?.email);
  const phone = cleanText(contact?.phone);

  const petOption = !!trip?.petOption;
  const babySeatOption = !!trip?.babySeatOption;

  const optionsRaw = Array.isArray(trip?.options) ? trip.options : [];
  const options = optionsRaw
    .map((o) => {
      const obj = (o || {}) as { id?: unknown; label?: unknown; fee?: unknown };
      const id = cleanText(obj.id);
      const label = cleanText(obj.label);
      const fee = typeof obj.fee === "number" ? obj.fee : null;
      return {
        id,
        label,
        fee,
      };
    })
    .filter((o) => !!o.id || !!o.label);

  const customOption = cleanText(trip?.customOption);

  const termsConsent = !!consents?.termsConsent;
  const marketingConsent = !!consents?.marketingConsent;

  const bookingEmailToOverride = cleanText(body?.config?.bookingEmailTo);

  const priceText = isQuote
    ? "Sur devis"
    : price !== null
      ? `${price.toFixed(2)} €`
      : "(inconnu)";

  const distanceText = distanceKm !== null ? `${distanceKm.toFixed(1)} km` : "(inconnu)";
  const durationText = durationMinutes !== null ? `${Math.round(durationMinutes)} min` : "(inconnu)";

  const dateTimeText = `${pickupDate}${pickupTime ? ` ${pickupTime}` : ""}`;

  const vehicleText = vehicleLabel ? `${vehicleLabel}${vehicle ? ` (${vehicle})` : ""}` : vehicle;

  const pricingModeText =
    pricingMode === "immediate"
      ? "Immédiat"
      : pricingMode === "reservation"
        ? "Réservation"
        : pricingMode === "all_quote"
          ? "Tout sur devis"
          : pricingMode;

  const surchargesText = (() => {
    if (!surchargesApplied || typeof surchargesApplied !== "object") return "";
    const obj = surchargesApplied as {
      kind?: unknown;
      baseDeltaAmount?: unknown;
      baseDeltaPercent?: unknown;
      totalDeltaPercent?: unknown;
    };

    const kind = cleanText(obj.kind);
    if (!kind) return "";

    const baseDeltaAmount = typeof obj.baseDeltaAmount === "number" ? obj.baseDeltaAmount : null;
    const baseDeltaPercent = typeof obj.baseDeltaPercent === "number" ? obj.baseDeltaPercent : null;
    const totalDeltaPercent = typeof obj.totalDeltaPercent === "number" ? obj.totalDeltaPercent : null;

    const parts: string[] = [];
    if (typeof baseDeltaAmount === "number" && baseDeltaAmount !== 0) parts.push(`+${baseDeltaAmount.toFixed(2)}€ (base)`);
    if (typeof baseDeltaPercent === "number" && baseDeltaPercent !== 0) parts.push(`+${baseDeltaPercent}% (base)`);
    if (typeof totalDeltaPercent === "number" && totalDeltaPercent !== 0) parts.push(`+${totalDeltaPercent}% (total)`);

    if (!parts.length) return kind;
    return `${kind}: ${parts.join(", ")}`;
  })();

  const optionsText = options.length
    ? options
        .map((o) => {
          const name = o.label || o.id;
          if (!name) return "";
          return typeof o.fee === "number" ? `${name} (+${o.fee.toFixed(2)} €)` : name;
        })
        .filter(Boolean)
        .join(" | ")
    : `animal=${petOption ? "oui" : "non"}, siège bébé=${babySeatOption ? "oui" : "non"}`;

  const text = [
    "Nouvelle réservation VTC",
    "",
    `Départ: ${start || "(non précisé)"}`,
    `Arrivée: ${end || "(non précisé)"}`,
    `Arrêts: ${stops.length ? stops.join(" | ") : "(aucun)"}`,
    `Date/Heure: ${dateTimeText || "(non précisé)"}`,
    pricingModeText ? `Type: ${pricingModeText}${typeof leadTimeThresholdMinutes === "number" ? ` (seuil ${leadTimeThresholdMinutes} min)` : ""}` : null,
    surchargesText ? `Majorations: ${surchargesText}` : null,
    `Véhicule: ${vehicleText || "(non précisé)"}`,
    `Options: ${optionsText}`,
    customOption ? `Option personnalisée: ${customOption}` : null,
    `Distance/Durée: ${distanceText} / ${durationText}`,
    `Tarif: ${priceText}`,
    "",
    `Client: ${name || "(non précisé)"}`,
    `Email: ${email || "(non précisé)"}`,
    `Téléphone: ${phone || "(non précisé)"}`,
    "",
    `Consentements: CGU/Privacy=${termsConsent ? "oui" : "non"}, Marketing=${marketingConsent ? "oui" : "non"}`,
  ]
    .filter((line): line is string => typeof line === "string" && !!line)
    .join("\n");

  const htmlStops = stops.length
    ? `<ul>${stops.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ul>`
    : "<p>(aucun)</p>";

  const htmlOptions = options.length
    ? `<ul>${options
        .map((o) => {
          const name = o.label || o.id || "";
          const suffix = typeof o.fee === "number" ? ` (+${o.fee.toFixed(2)} €)` : "";
          return `<li>${escapeHtml(`${name}${suffix}`)}</li>`;
        })
        .join("")}</ul>`
    : `<p>animal=${petOption ? "oui" : "non"}, siège bébé=${babySeatOption ? "oui" : "non"}</p>`;

  const routeText = `${start || "(non précisé)"} → ${end || "(non précisé)"}`;

  const html = `
    <div style="margin:0;padding:0;background:#f6f7fb;">
      <div style="max-width:760px;margin:0 auto;padding:18px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
        <div style="background:#ffffff;border:1px solid #e7e8ee;border-radius:16px;overflow:hidden;">
          <div style="padding:16px 18px;background:linear-gradient(135deg,#0b1226,#0f172a);color:#ffffff;">
            <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
              <tr>
                <td style="vertical-align:top;">
                  <div style="font-size:18px;font-weight:800;letter-spacing:-0.01em;">Nouvelle réservation VTC</div>
                  <div style="margin-top:6px;font-size:13px;opacity:0.9;">${escapeHtml(routeText)}</div>
                </td>
                <td style="vertical-align:top;text-align:right;white-space:nowrap;">
                  <div style="display:inline-block;background:#ffffff;color:#0f172a;border-radius:999px;padding:8px 10px;font-weight:800;font-size:13px;">💶 ${escapeHtml(priceText)}</div>
                </td>
              </tr>
            </table>
          </div>

          <div style="padding:16px 18px;">
            <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
              <tr>
                <td style="vertical-align:top;padding-right:10px;width:58%;">
                  <div style="font-size:14px;font-weight:800;margin:0 0 10px 0;">🚗 Trajet</div>

                  <div style="margin:0 0 8px 0;font-size:13px;">
                    <b>📍 Départ:</b> ${escapeHtml(start || "(non précisé)")}
                  </div>
                  <div style="margin:0 0 8px 0;font-size:13px;">
                    <b>🏁 Arrivée:</b> ${escapeHtml(end || "(non précisé)")}
                  </div>

                  <div style="margin:0 0 8px 0;font-size:13px;">
                    <b>🗓️ Date/Heure:</b> ${escapeHtml(dateTimeText || "(non précisé)")}
                  </div>

                  <div style="margin:0 0 8px 0;font-size:13px;">
                    <b>🚘 Véhicule:</b> ${escapeHtml(vehicleText || "(non précisé)")}
                  </div>

                  ${pricingModeText ? `<div style="margin:0 0 8px 0;font-size:13px;"><b>⏱️ Type:</b> ${escapeHtml(pricingModeText)}${typeof leadTimeThresholdMinutes === "number" ? ` (seuil ${escapeHtml(String(leadTimeThresholdMinutes))} min)` : ""}</div>` : ""}
                  ${surchargesText ? `<div style="margin:0 0 8px 0;font-size:13px;"><b>➕ Majorations:</b> ${escapeHtml(surchargesText)}</div>` : ""}

                  <div style="margin:0 0 8px 0;font-size:13px;">
                    <b>📏 Distance/Durée:</b> ${escapeHtml(distanceText)} / ${escapeHtml(durationText)}
                  </div>

                  <div style="margin:12px 0 6px 0;font-size:13px;font-weight:800;">🧭 Arrêts</div>
                  <div style="margin:0;font-size:13px;color:#0f172a;">${htmlStops}</div>

                  <div style="margin:12px 0 6px 0;font-size:13px;font-weight:800;">✅ Options</div>
                  <div style="margin:0;font-size:13px;color:#0f172a;">${htmlOptions}</div>

                  ${customOption ? `<div style="margin:10px 0 0 0;font-size:13px;"><b>📝 Option personnalisée:</b> ${escapeHtml(customOption)}</div>` : ""}
                </td>

                <td style="vertical-align:top;padding-left:10px;width:42%;">
                  <div style="font-size:14px;font-weight:800;margin:0 0 10px 0;">👤 Client</div>
                  <div style="margin:0 0 8px 0;font-size:13px;"><b>Nom:</b> ${escapeHtml(name || "(non précisé)")}</div>
                  <div style="margin:0 0 8px 0;font-size:13px;">
                    <b>📧 Email:</b> ${email ? `<a href="mailto:${escapeHtml(email)}" style="color:#2563eb;text-decoration:none;">${escapeHtml(email)}</a>` : escapeHtml("(non précisé)")}
                  </div>
                  <div style="margin:0 0 8px 0;font-size:13px;">
                    <b>📞 Téléphone:</b> ${phone ? `<a href="tel:${escapeHtml(phone)}" style="color:#2563eb;text-decoration:none;">${escapeHtml(phone)}</a>` : escapeHtml("(non précisé)")}
                  </div>

                  <div style="margin-top:14px;padding:12px;border-radius:14px;border:1px solid #e7e8ee;background:#fafafa;">
                    <div style="font-weight:800;font-size:13px;margin:0 0 8px 0;">🔒 Consentements</div>
                    <div style="font-size:13px;">CGU/Privacy: <b>${termsConsent ? "oui" : "non"}</b></div>
                    <div style="font-size:13px;">Marketing: <b>${marketingConsent ? "oui" : "non"}</b></div>
                  </div>

                  <div style="margin-top:14px;font-size:12px;color:#64748b;line-height:1.4;">
                    Répondre à cet email répondra au client (Reply-To).
                  </div>
                </td>
              </tr>
            </table>
          </div>
        </div>
      </div>
    </div>
  `.trim();

  return {
    start,
    end,
    pickupDate,
    pickupTime,
    vehicle,
    stops,
    isQuote,
    price,
    pricingMode,
    leadTimeThresholdMinutes,
    surchargesApplied,
    distanceKm,
    durationMinutes,
    name,
    email,
    phone,
    termsConsent,
    marketingConsent,
    text,
    html,
    bookingEmailToOverride: bookingEmailToOverride || undefined,
  };
}

export function validateBookingSummary(summary: BookingSummary) {
  if (!summary.start || !summary.end || !summary.pickupDate) {
    return "Données de trajet incomplètes (départ/arrivée/date requis).";
  }

  if (!summary.name || !summary.email || !summary.phone) {
    return "Coordonnées client incomplètes (nom/e-mail/téléphone requis).";
  }

  if (!summary.termsConsent) {
    return "Consentement requis (CGU / Politique de confidentialité).";
  }

  return null;
}

export function getEmailConfig(emailToOverride?: string) {
  const host = cleanText(process.env.SMTP_HOST);
  const portRaw = cleanText(process.env.SMTP_PORT);
  const secure = parseBooleanEnv(process.env.SMTP_SECURE);
  const user = cleanText(process.env.SMTP_USER);
  const pass = cleanText(process.env.SMTP_PASS);

  const from = cleanText(process.env.BOOKING_EMAIL_FROM);

  const envTo = cleanText(process.env.BOOKING_EMAIL_TO);
  const settingTo = cleanText(emailToOverride);
  const to = isValidSingleEmail(settingTo) ? settingTo : envTo;

  const port = portRaw ? Number(portRaw) : NaN;

  const missing: string[] = [];
  if (!host) missing.push("SMTP_HOST");
  if (!portRaw || !Number.isFinite(port) || port <= 0) missing.push("SMTP_PORT");
  if (!user) missing.push("SMTP_USER");
  if (!pass) missing.push("SMTP_PASS");
  if (!from) missing.push("BOOKING_EMAIL_FROM");
  if (!to) missing.push("BOOKING_EMAIL_TO");

  const configured = missing.length === 0;

  return {
    configured,
    missing,
    host,
    port,
    secure,
    user,
    pass,
    from,
    to,
    toSource: isValidSingleEmail(settingTo) ? "setting" : "env",
  } as const;
}

export function getEmailConfigExplicit(toRaw: string) {
  const host = cleanText(process.env.SMTP_HOST);
  const portRaw = cleanText(process.env.SMTP_PORT);
  const secure = parseBooleanEnv(process.env.SMTP_SECURE);
  const user = cleanText(process.env.SMTP_USER);
  const pass = cleanText(process.env.SMTP_PASS);
  const from = cleanText(process.env.BOOKING_EMAIL_FROM);

  const to = cleanText(toRaw);

  const port = portRaw ? Number(portRaw) : NaN;

  const missing: string[] = [];
  if (!host) missing.push("SMTP_HOST");
  if (!portRaw || !Number.isFinite(port) || port <= 0) missing.push("SMTP_PORT");
  if (!user) missing.push("SMTP_USER");
  if (!pass) missing.push("SMTP_PASS");
  if (!from) missing.push("BOOKING_EMAIL_FROM");
  if (!isValidSingleEmail(to)) missing.push("BOOKING_EMAIL_TO (tenant)");

  const configured = missing.length === 0;

  return {
    configured,
    missing,
    host,
    port,
    secure,
    user,
    pass,
    from,
    to,
    toSource: "explicit" as const,
  } as const;
}

export async function sendBookingEmail(summary: BookingSummary) {
  const emailConfig = getEmailConfig(summary.bookingEmailToOverride);
  if (!emailConfig.configured) {
    return {
      ok: false as const,
      error: "EMAIL_NOT_CONFIGURED" as const,
      missing: emailConfig.missing,
    };
  }

  const transporter = nodemailer.createTransport({
    host: emailConfig.host,
    port: emailConfig.port,
    secure: emailConfig.secure,
    auth: { user: emailConfig.user, pass: emailConfig.pass },
  });

  await transporter.sendMail({
    from: emailConfig.from,
    to: emailConfig.to,
    subject: "Nouvelle réservation VTC",
    text: summary.text,
    html: summary.html,
    replyTo: summary.email || undefined,
  });

  return {
    ok: true as const,
    to: emailConfig.to,
    toSource: emailConfig.toSource,
  };
}

export async function sendBookingEmailTo(summary: BookingSummary, to: string) {
  const emailConfig = getEmailConfigExplicit(to);
  if (!emailConfig.configured) {
    return {
      ok: false as const,
      error: "EMAIL_NOT_CONFIGURED" as const,
      missing: emailConfig.missing,
    };
  }

  const transporter = nodemailer.createTransport({
    host: emailConfig.host,
    port: emailConfig.port,
    secure: emailConfig.secure,
    auth: { user: emailConfig.user, pass: emailConfig.pass },
  });

  await transporter.sendMail({
    from: emailConfig.from,
    to: emailConfig.to,
    subject: "Nouvelle réservation VTC",
    text: summary.text,
    html: summary.html,
    replyTo: summary.email || undefined,
  });

  return {
    ok: true as const,
    to: emailConfig.to,
    toSource: emailConfig.toSource,
  };
}

export async function sendCustomerConfirmationEmail(summary: BookingSummary) {
  const to = cleanText(summary.email);
  if (!isValidSingleEmail(to)) {
    return { ok: false as const, error: "CUSTOMER_EMAIL_INVALID" as const };
  }

  const emailConfig = getEmailConfigExplicit(to);
  if (!emailConfig.configured) {
    return {
      ok: false as const,
      error: "EMAIL_NOT_CONFIGURED" as const,
      missing: emailConfig.missing,
    };
  }

  const transporter = nodemailer.createTransport({
    host: emailConfig.host,
    port: emailConfig.port,
    secure: emailConfig.secure,
    auth: { user: emailConfig.user, pass: emailConfig.pass },
  });

  const subject = "Confirmation — demande de réservation VTC";
  const text = [
    "Bonjour,",
    "",
    "Nous avons bien reçu votre demande de réservation.",
    "Nous vous recontactons rapidement pour confirmer le trajet.",
    "",
    "Récapitulatif:",
    summary.text,
  ].join("\n");

  const html = [
    "<p>Bonjour,</p>",
    "<p>Nous avons bien reçu votre demande de réservation.<br/>Nous vous recontactons rapidement pour confirmer le trajet.</p>",
    "<hr/>",
    summary.html,
  ].join("");

  await transporter.sendMail({
    from: emailConfig.from,
    to: emailConfig.to,
    subject,
    text,
    html,
  });

  return { ok: true as const, to: emailConfig.to };
}

export async function sendSlackOptional(
  text: string,
  options?: { enabled?: boolean; webhookUrl?: string | null },
) {
  if (options?.enabled === false) {
    return { ok: false as const, error: "SLACK_DISABLED" as const };
  }

  const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
  const allowFallback = ["1", "true", "yes"].includes(
    String(process.env.ALLOW_DEFAULT_SLACK_FALLBACK || "").trim().toLowerCase(),
  );

  const hasOverride = !!options && Object.prototype.hasOwnProperty.call(options, "webhookUrl");
  const webhook = hasOverride
    ? cleanText(options.webhookUrl)
    : !isProd && allowFallback
      ? cleanText(process.env.DEFAULT_SLACK_WEBHOOK_URL) || cleanText(process.env.SLACK_WEBHOOK_URL)
      : "";
  if (!webhook) return { ok: false as const, error: "SLACK_NOT_CONFIGURED" as const };

  try {
    const resp = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    const bodyText = await resp.text().catch(() => "");
    if (!resp.ok) {
      const details = `${resp.status} ${bodyText}`.trim().slice(0, 500);
      return { ok: false as const, error: "SLACK_FAILED" as const, details };
    }

    return { ok: true as const };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false as const,
      error: "SLACK_EXCEPTION" as const,
      details: message.slice(0, 500),
    };
  }
}

export async function sendSlackRequired(text: string, options?: { webhookUrl?: string | null }) {
  const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
  const allowFallback = ["1", "true", "yes"].includes(
    String(process.env.ALLOW_DEFAULT_SLACK_FALLBACK || "").trim().toLowerCase(),
  );

  const hasOverride = !!options && Object.prototype.hasOwnProperty.call(options, "webhookUrl");
  const webhook = hasOverride
    ? cleanText(options.webhookUrl)
    : !isProd && allowFallback
      ? cleanText(process.env.DEFAULT_SLACK_WEBHOOK_URL) || cleanText(process.env.SLACK_WEBHOOK_URL)
      : "";
  if (!webhook) return { ok: false as const, error: "SLACK_WEBHOOK_URL missing" as const };

  const res = await sendSlackOptional(text, { webhookUrl: webhook });
  if (res.ok) return { ok: true as const };

  if (res.error === "SLACK_NOT_CONFIGURED") {
    return { ok: false as const, error: "SLACK_WEBHOOK_URL missing" as const };
  }

  return { ok: false as const, error: "Slack webhook failed" as const, details: res.details };
}

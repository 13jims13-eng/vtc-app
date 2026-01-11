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

  const html = `
    <h2>Nouvelle réservation VTC</h2>
    <h3>Trajet</h3>
    <p><b>Départ:</b> ${escapeHtml(start || "(non précisé)")}</p>
    <p><b>Arrivée:</b> ${escapeHtml(end || "(non précisé)")}</p>
    <p><b>Arrêts:</b></p>
    ${htmlStops}
    <p><b>Date/Heure:</b> ${escapeHtml(dateTimeText || "(non précisé)")}</p>
    ${pricingModeText ? `<p><b>Type:</b> ${escapeHtml(pricingModeText)}${typeof leadTimeThresholdMinutes === "number" ? ` (seuil ${escapeHtml(String(leadTimeThresholdMinutes))} min)` : ""}</p>` : ""}
    ${surchargesText ? `<p><b>Majorations:</b> ${escapeHtml(surchargesText)}</p>` : ""}
    <p><b>Véhicule:</b> ${escapeHtml(vehicleText || "(non précisé)")}</p>
    <p><b>Options:</b></p>
    ${htmlOptions}
    ${customOption ? `<p><b>Option personnalisée:</b> ${escapeHtml(customOption)}</p>` : ""}
    <p><b>Distance/Durée:</b> ${escapeHtml(distanceText)} / ${escapeHtml(durationText)}</p>
    <p><b>Tarif:</b> ${escapeHtml(priceText)}</p>
    <h3>Client</h3>
    <p><b>Nom:</b> ${escapeHtml(name || "(non précisé)")}</p>
    <p><b>Email:</b> ${escapeHtml(email || "(non précisé)")}</p>
    <p><b>Téléphone:</b> ${escapeHtml(phone || "(non précisé)")}</p>
    <h3>Consentements</h3>
    <p>CGU/Privacy=${termsConsent ? "oui" : "non"}, Marketing=${marketingConsent ? "oui" : "non"}</p>
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

export async function sendSlackOptional(
  text: string,
  options?: { enabled?: boolean; webhookUrl?: string | null },
) {
  if (options?.enabled === false) {
    return { ok: false as const, error: "SLACK_DISABLED" as const };
  }

  const hasOverride = !!options && Object.prototype.hasOwnProperty.call(options, "webhookUrl");
  const webhook = hasOverride
    ? cleanText(options.webhookUrl)
    : cleanText(process.env.SLACK_WEBHOOK_URL);
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
  const hasOverride = !!options && Object.prototype.hasOwnProperty.call(options, "webhookUrl");
  const webhook = hasOverride
    ? cleanText(options.webhookUrl)
    : cleanText(process.env.SLACK_WEBHOOK_URL);
  if (!webhook) return { ok: false as const, error: "SLACK_WEBHOOK_URL missing" as const };

  const res = await sendSlackOptional(text, { webhookUrl: webhook });
  if (res.ok) return { ok: true as const };

  if (res.error === "SLACK_NOT_CONFIGURED") {
    return { ok: false as const, error: "SLACK_WEBHOOK_URL missing" as const };
  }

  return { ok: false as const, error: "Slack webhook failed" as const, details: res.details };
}

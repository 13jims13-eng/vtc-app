import type { ActionFunctionArgs } from "react-router";

type SlackBookingRequestBody = {
  contact?: {
    name?: string;
    email?: string;
    phone?: string;
  };
  trip?: {
    start?: string;
    end?: string;
    stops?: unknown[];
    pickupDate?: string;
    pickupTime?: string;
    vehicle?: string;
    isQuote?: boolean;
    petOption?: boolean;
    babySeatOption?: boolean;
    customOption?: string;
    price?: number;
    distanceKm?: number;
    durationMinutes?: number;
  };
  consents?: {
    termsConsent?: boolean;
    marketingConsent?: boolean;
  };
};

function jsonResponse(data: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

function corsHeaders(request: Request) {
  const origin = request.headers.get("Origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function toYesNo(value: unknown) {
  return value ? "oui" : "non";
}

async function postSlackViaIncomingWebhook(webhookUrl: string, payload: unknown) {
  return fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

export const action = async ({ request }: ActionFunctionArgs) => {
  console.log("slack-booking hit", {
    method: request.method,
    url: request.url,
  });

  try {
    // CORS preflight (utile si jamais appelé cross-origin)
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    if (request.method !== "POST") {
      return jsonResponse(
        { ok: false, error: "Method not allowed" },
        { status: 405, headers: corsHeaders(request) },
      );
    }

    const webhook = cleanText(process.env.SLACK_WEBHOOK_URL);

    if (!webhook) {
      console.error("SLACK_WEBHOOK_URL missing");
      return jsonResponse(
        { ok: false, error: "SLACK_WEBHOOK_URL missing" },
        { status: 500, headers: corsHeaders(request) },
      );
    }

    let body: SlackBookingRequestBody;
    try {
      body = (await request.json()) as SlackBookingRequestBody;
    } catch {
      return jsonResponse(
        { ok: false, error: "JSON invalide" },
        { status: 400, headers: corsHeaders(request) },
      );
    }

    const contact = body?.contact || {};
    const trip = body?.trip || {};
    const consents = body?.consents;

    const start = cleanText(trip?.start);
    const end = cleanText(trip?.end);
    const pickupDate = cleanText(trip?.pickupDate);
    const pickupTime = cleanText(trip?.pickupTime);
    const vehicle = cleanText(trip?.vehicle);

    const stops: string[] = Array.isArray(trip?.stops)
      ? trip.stops.map((s) => cleanText(s)).filter(Boolean)
      : [];

    const isQuote = vehicle === "autre" || !!trip?.isQuote;
    const price = typeof trip?.price === "number" ? trip.price : null;

    const distanceKm = typeof trip?.distanceKm === "number" ? trip.distanceKm : null;
    const durationMinutes = typeof trip?.durationMinutes === "number" ? trip.durationMinutes : null;

    const name = cleanText(contact?.name);
    const email = cleanText(contact?.email);
    const phone = cleanText(contact?.phone);

    if (!start || !end || !pickupDate) {
      return jsonResponse(
        {
          ok: false,
          error: "Données de trajet incomplètes (départ/arrivée/date requis).",
        },
        { status: 400, headers: corsHeaders(request) },
      );
    }

    if (!name || !email || !phone) {
      return jsonResponse(
        {
          ok: false,
          error: "Coordonnées client incomplètes (nom/e-mail/téléphone requis).",
        },
        { status: 400, headers: corsHeaders(request) },
      );
    }

    console.log("incoming payload ok", {
      start,
      end,
      stopsCount: stops.length,
      pickupDate,
      hasPickupTime: !!pickupTime,
      vehicle: vehicle || null,
      isQuote,
      hasPrice: typeof price === "number",
      hasDistance: typeof distanceKm === "number",
      hasDuration: typeof durationMinutes === "number",
      hasContact: true,
      hasConsents: !!consents,
      termsConsent: !!consents?.termsConsent,
      marketingConsent: !!consents?.marketingConsent,
    });

    const priceText = isQuote
      ? "Sur devis"
      : price !== null
        ? `${price.toFixed(2)} €`
        : "(inconnu)";

    const stopsText = stops.length ? stops.map((s) => `• ${s}`).join("\n") : "(aucun)";
    const vehicleText = vehicle || "(non précisé)";
    const dateTimeText = `${pickupDate}${pickupTime ? ` ${pickupTime}` : ""}`;

    const text = [
      "Nouvelle réservation – VTC Smart Booking",
      "",
      `Départ: ${start}`,
      `Arrivée: ${end}`,
      `Arrêts:\n${stopsText}`,
      `Date/Heure: ${dateTimeText}`,
      `Véhicule: ${vehicleText}`,
      `Distance/Durée: ${distanceKm !== null ? `${distanceKm.toFixed(1)} km` : "(inconnu)"} / ${
        durationMinutes !== null ? `${Math.round(durationMinutes)} min` : "(inconnu)"
      }`,
      `Prix: ${priceText}`,
      "",
      `Client: ${name} | ${email} | ${phone}`,
      "",
      `Consentements: CGU/Privacy=${toYesNo(consents?.termsConsent)}, Marketing=${toYesNo(
        consents?.marketingConsent,
      )}`,
    ].join("\n");

    const slackPayload = { text };

    console.log("calling Slack", { hasWebhook: true });
    const resp = await postSlackViaIncomingWebhook(webhook, slackPayload);
    const respText = await resp.text().catch(() => "");

    console.log("Slack response", {
      ok: resp.ok,
      status: resp.status,
      bodyPreview: respText.slice(0, 500),
    });

    if (!resp.ok) {
      const details = `${resp.status} ${respText}`.trim();
      console.error("Slack webhook failed", details);
      return jsonResponse(
        { ok: false, error: "Slack webhook failed", details },
        { status: 500, headers: corsHeaders(request) },
      );
    }

    return jsonResponse({ ok: true }, { status: 200, headers: corsHeaders(request) });
  } catch (err) {
    const stack = err instanceof Error ? err.stack : String(err);
    console.error("slack-booking exception", stack);
    return jsonResponse(
      { ok: false, error: "Internal error" },
      { status: 500, headers: corsHeaders(request) },
    );
  }
};

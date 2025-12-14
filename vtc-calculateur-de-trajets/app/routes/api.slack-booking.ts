import type { ActionFunctionArgs } from "react-router";
import {
  buildBookingSummary,
  sendSlackRequired,
  validateBookingSummary,
  type BookingNotifyRequestBody,
} from "../lib/bookingNotify.server";

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

export const action = async ({ request }: ActionFunctionArgs) => {
  console.log("slack-booking hit", {
    method: request.method,
    path: new URL(request.url).pathname,
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

    let body: BookingNotifyRequestBody;
    try {
      body = (await request.json()) as BookingNotifyRequestBody;
    } catch {
      return jsonResponse(
        { ok: false, error: "JSON invalide" },
        { status: 400, headers: corsHeaders(request) },
      );
    }

    const summary = buildBookingSummary(body);
    const validationError = validateBookingSummary(summary);
    if (validationError) {
      return jsonResponse(
        { ok: false, error: validationError },
        { status: 400, headers: corsHeaders(request) },
      );
    }

    console.log("incoming payload ok", {
      start: summary.start,
      end: summary.end,
      stopsCount: summary.stops.length,
      pickupDate: summary.pickupDate,
      hasPickupTime: !!summary.pickupTime,
      vehicle: summary.vehicle || null,
      isQuote: summary.isQuote,
      hasPrice: typeof summary.price === "number",
      hasDistance: typeof summary.distanceKm === "number",
      hasDuration: typeof summary.durationMinutes === "number",
      termsConsent: summary.termsConsent,
      marketingConsent: summary.marketingConsent,
    });

    const slackRes = await sendSlackRequired(summary.text);
    if (!slackRes.ok) {
      console.error("slack ko", { error: slackRes.error });
      return jsonResponse(
        { ok: false, error: slackRes.error, details: slackRes.details },
        { status: 500, headers: corsHeaders(request) },
      );
    }

    console.log("slack ok");
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

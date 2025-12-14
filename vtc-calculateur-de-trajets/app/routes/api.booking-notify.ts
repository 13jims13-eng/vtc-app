import type { ActionFunctionArgs } from "react-router";
import {
  buildBookingSummary,
  sendBookingEmail,
  sendSlackOptional,
  validateBookingSummary,
  type BookingNotifyRequestBody,
} from "../lib/bookingNotify.server";

function jsonResponse(data: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const requestUrl = new URL(request.url);
  console.log("notify hit", { method: request.method, path: requestUrl.pathname });

  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed" }, { status: 500 });
  }

  let body: BookingNotifyRequestBody;
  try {
    body = (await request.json()) as BookingNotifyRequestBody;
  } catch {
    return jsonResponse({ ok: false, error: "JSON invalide" }, { status: 500 });
  }

  const summary = buildBookingSummary(body);
  const validationError = validateBookingSummary(summary);
  if (validationError) {
    return jsonResponse({ ok: false, error: validationError }, { status: 500 });
  }

  console.log("incoming payload ok", {
    hasContact: true,
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
    hasBookingEmailTo: !!summary.bookingEmailToOverride,
  });

  try {
    const emailRes = await sendBookingEmail(summary);
    if (!emailRes.ok) {
      console.error("email ko", { error: emailRes.error });
      return jsonResponse({ ok: false, error: emailRes.error }, { status: 500 });
    }
    console.log("email ok", { toSource: emailRes.toSource });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("email ko", { error: "EMAIL_FAILED", message: message.slice(0, 500) });
    return jsonResponse({ ok: false, error: "EMAIL_FAILED" }, { status: 500 });
  }

  const slackResult = await sendSlackOptional(summary.text);
  if (slackResult.ok) {
    console.log("slack ok");
  } else if (slackResult.error === "SLACK_NOT_CONFIGURED") {
    console.log("slack skip");
  } else {
    console.error("slack ko", { error: slackResult.error });
  }

  return jsonResponse({ ok: true }, { status: 200 });
};

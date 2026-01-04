import type { ActionFunctionArgs } from "react-router";
import {
  buildBookingSummary,
  sendBookingEmail,
  sendSlackOptional,
  validateBookingSummary,
  type BookingNotifyRequestBody,
} from "../lib/bookingNotify.server";
import { resolveSlackWebhookForShop } from "../lib/slackConfig.server";

function jsonResponse(data: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const requestUrl = new URL(request.url);
  const requestId = request.headers.get("X-Request-Id") || null;
  console.log("notify hit", { method: request.method, path: requestUrl.pathname, requestId });

  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed", requestId }, { status: 405 });
  }

  let body: BookingNotifyRequestBody;
  try {
    body = (await request.json()) as BookingNotifyRequestBody;
  } catch {
    return jsonResponse({ ok: false, error: "JSON invalide", requestId }, { status: 400 });
  }

  const summaryBase = buildBookingSummary(body);
  const summary = summaryBase;
  const validationError = validateBookingSummary(summary);
  if (validationError) {
    return jsonResponse({ ok: false, error: validationError, requestId }, { status: 400 });
  }

  const shop = String(requestUrl.searchParams.get("shop") || "").trim() || null;
  const slackEnabled = body?.config?.slackEnabled !== false;
  const slackDestinationKey = String(body?.config?.slackDestination || "").trim() || null;

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
    slackEnabled,
    slackDestinationKey,
    shop,
  });

  try {
    const emailRes = await sendBookingEmail(summary);
    if (!emailRes.ok) {
      console.error("email ko", { error: emailRes.error, missing: emailRes.missing || [] });
      return jsonResponse({ ok: false, error: emailRes.error, requestId }, { status: 500 });
    }
    console.log("email ok", { toSource: emailRes.toSource });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("email ko", { error: "EMAIL_FAILED", message: message.slice(0, 500) });
    return jsonResponse({ ok: false, error: "EMAIL_FAILED", requestId }, { status: 500 });
  }

  if (!slackEnabled) {
    console.log("slack skip", {
      shop,
      slackEnabled,
      slackDestinationKey,
      webhookSource: "none",
    });
    return jsonResponse({ ok: true, requestId }, { status: 200 });
  }

  const resolved = shop
    ? await resolveSlackWebhookForShop({ shop, destinationKey: slackDestinationKey })
    : ({ ok: false, source: "none", destinationKey: slackDestinationKey } as const);

  console.log("slack resolved", {
    shop,
    slackEnabled,
    slackDestinationKey: resolved.destinationKey,
    webhookSource: resolved.ok ? resolved.source : "none",
  });

  if (resolved.ok) {
    const slackResult = await sendSlackOptional(summary.text, {
      enabled: true,
      webhookUrl: resolved.webhookUrl,
    });

    if (slackResult.ok) {
      console.log("slack ok");
    } else if (slackResult.error === "SLACK_NOT_CONFIGURED" || slackResult.error === "SLACK_DISABLED") {
      console.log("slack skip");
    } else {
      console.error("slack ko", { error: slackResult.error, details: slackResult.details });
    }
  } else {
    console.log("slack skip", {
      shop,
      slackEnabled,
      slackDestinationKey: resolved.destinationKey,
      webhookSource: "none",
    });
  }

  return jsonResponse({ ok: true, requestId }, { status: 200 });
};

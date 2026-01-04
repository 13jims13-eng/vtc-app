import type { ActionFunctionArgs } from "react-router";
import {
  buildBookingSummary,
  sendBookingEmail,
  sendSlackOptional,
  validateBookingSummary,
  type BookingNotifyRequestBody,
} from "../lib/bookingNotify.server";
import { getShopConfig } from "../lib/shopConfig.server";

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

  const shop = requestUrl.searchParams.get("shop");
  const shopConfig = shop ? await getShopConfig(shop) : null;

  const summaryBase = buildBookingSummary(body);
  const summary =
    !summaryBase.bookingEmailToOverride && shopConfig?.bookingEmailTo
      ? { ...summaryBase, bookingEmailToOverride: shopConfig.bookingEmailTo }
      : summaryBase;
  const validationError = validateBookingSummary(summary);
  if (validationError) {
    return jsonResponse({ ok: false, error: validationError, requestId }, { status: 400 });
  }

  const slackEnabled = body?.config?.slackEnabled !== false;

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

  const slackWebhookUrlOption = shopConfig
    ? // Row exists => use DB value (null means explicitly disabled)
      ({ webhookUrl: shopConfig.slackWebhookUrl } as const)
    : // No row yet => keep existing env behavior as the default
      undefined;

  const slackResult = await sendSlackOptional(summary.text, {
    enabled: slackEnabled,
    ...(slackWebhookUrlOption ?? {}),
  });
  if (slackResult.ok) {
    console.log("slack ok");
  } else if (slackResult.error === "SLACK_NOT_CONFIGURED" || slackResult.error === "SLACK_DISABLED") {
    console.log("slack skip");
  } else {
    console.error("slack ko", { error: slackResult.error, details: slackResult.details });
  }

  return jsonResponse({ ok: true, requestId }, { status: 200 });
};

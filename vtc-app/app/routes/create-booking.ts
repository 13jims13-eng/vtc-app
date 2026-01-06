import type { ActionFunctionArgs } from "react-router";
import {
  buildBookingSummary,
  sendBookingEmailTo,
  sendSlackOptional,
  validateBookingSummary,
  type BookingNotifyRequestBody,
} from "../lib/bookingNotify.server";
import { createSupabaseServiceClient } from "../lib/supabase.server";
import { computeTariffForVehicle } from "../lib/pricing.server";
import { getTenantRuntimeConfigBySlug } from "../lib/tenant.server";

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

function getRequestIp(request: Request) {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || null;
  const cf = request.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  return null;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    if (request.method !== "POST") {
      return jsonResponse({ ok: false, error: "Method not allowed" }, { status: 405, headers: corsHeaders(request) });
    }

    let body: any;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ ok: false, error: "JSON invalide" }, { status: 400, headers: corsHeaders(request) });
    }

    const slug = String(body?.slug || "").trim().toLowerCase();
    if (!slug) {
      return jsonResponse({ ok: false, error: "slug requis" }, { status: 400, headers: corsHeaders(request) });
    }

    const resolved = await getTenantRuntimeConfigBySlug(slug);
    if (!resolved.ok) {
      return jsonResponse({ ok: false, error: "TENANT_NOT_FOUND" }, { status: 404, headers: corsHeaders(request) });
    }

    const contact = body?.contact || {};
    const trip = body?.trip || {};
    const consents = body?.consents || {};

    const pickupDate = String(trip?.pickupDate || "").trim();
    const pickupTime = String(trip?.pickupTime || "").trim();

    const km = Number(trip?.distanceKm);
    const durationMinutes = Number(trip?.durationMinutes);
    const vehicleId = String(trip?.vehicle || trip?.vehicleId || "").trim();

    const stops = Array.isArray(trip?.stops)
      ? trip.stops
      : Array.isArray(trip?.waypoints)
        ? trip.waypoints
        : [];

    const selectedOptionIds = Array.isArray(trip?.optionIds) ? trip.optionIds : Array.isArray(trip?.options) ? trip.options : [];

    const tariff = computeTariffForVehicle(resolved.pricing, {
      km,
      stopsCount: Array.isArray(stops) ? stops.length : 0,
      pickupDate,
      pickupTime,
      vehicleId,
      selectedOptionIds,
    });

    if (!tariff.ok) {
      return jsonResponse({ ok: false, error: tariff.error }, { status: 400, headers: corsHeaders(request) });
    }

    const notifyBody: BookingNotifyRequestBody = {
      contact: {
        name: String(contact?.name || "").trim(),
        email: String(contact?.email || "").trim(),
        phone: String(contact?.phone || "").trim(),
      },
      trip: {
        start: String(trip?.start || "").trim(),
        end: String(trip?.end || "").trim(),
        stops: Array.isArray(stops) ? stops : [],
        pickupDate,
        pickupTime,
        vehicle: vehicleId,
        vehicleLabel: tariff.isQuote ? (tariff.vehicleLabel || vehicleId) : tariff.vehicleLabel,
        isQuote: tariff.isQuote,
        price: tariff.isQuote ? undefined : Number(tariff.total),
        pricingMode: tariff.pricingMode ? String(tariff.pricingMode) : undefined,
        leadTimeThresholdMinutes: tariff.isQuote ? undefined : tariff.leadTimeThresholdMinutes,
        surchargesApplied: tariff.isQuote ? undefined : tariff.surchargesApplied,
        distanceKm: Number.isFinite(km) ? km : undefined,
        durationMinutes: Number.isFinite(durationMinutes) ? durationMinutes : undefined,
        options: tariff.isQuote ? [] : tariff.appliedOptions,
        optionsTotalFee: tariff.isQuote ? 0 : tariff.optionsFee,
        customOption: String(trip?.customOption || "").trim() || undefined,
      },
      consents: {
        termsConsent: !!consents?.termsConsent,
        marketingConsent: !!consents?.marketingConsent,
      },
      config: {
        bookingEmailTo: resolved.bookingEmailTo || undefined,
        slackEnabled: true,
      },
    };

    const summary = buildBookingSummary(notifyBody);
    const validationError = validateBookingSummary(summary);
    if (validationError) {
      return jsonResponse({ ok: false, error: validationError }, { status: 400, headers: corsHeaders(request) });
    }

    const supabase = createSupabaseServiceClient();

    const insertRes = await supabase
      .from("bookings")
      .insert({
        tenant_id: resolved.tenant.id,
        slug: resolved.tenant.slug,
        status: "new",
        contact_name: summary.name,
        contact_email: summary.email,
        contact_phone: summary.phone,
        start: summary.start,
        end: summary.end,
        stops: summary.stops,
        pickup_date: summary.pickupDate,
        pickup_time: summary.pickupTime,
        vehicle_id: summary.vehicle,
        vehicle_label: tariff.isQuote ? tariff.vehicleLabel : tariff.vehicleLabel,
        is_quote: tariff.isQuote,
        price_total: tariff.isQuote ? null : Number(tariff.total),
        pricing_mode: tariff.isQuote ? tariff.pricingMode : tariff.pricingMode,
        lead_time_threshold_minutes: tariff.isQuote ? null : tariff.leadTimeThresholdMinutes,
        surcharges_applied: tariff.isQuote ? null : tariff.surchargesApplied,
        distance_km: Number.isFinite(km) ? km : null,
        duration_minutes: Number.isFinite(durationMinutes) ? durationMinutes : null,
        applied_options: tariff.isQuote ? [] : tariff.appliedOptions,
        options_total_fee: tariff.isQuote ? 0 : tariff.optionsFee,
        user_agent: request.headers.get("user-agent") || null,
        ip: getRequestIp(request),
      })
      .select("id")
      .maybeSingle();

    if (insertRes.error) {
      console.error("create-booking insert error", insertRes.error.message);
      return jsonResponse({ ok: false, error: "DB_INSERT_FAILED" }, { status: 500, headers: corsHeaders(request) });
    }

    const bookingId = (insertRes.data as any)?.id ?? null;

    // Notifications (sans fallback global).
    if (resolved.bookingEmailTo) {
      try {
        const emailRes = await sendBookingEmailTo(summary, resolved.bookingEmailTo);
        if (!emailRes.ok) {
          console.error("email ko", { error: emailRes.error, missing: emailRes.missing || [] });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("email exception", message.slice(0, 500));
      }
    } else {
      console.log("email skip (tenant not configured)", { slug });
    }

    try {
      const slackRes = await sendSlackOptional(summary.text, {
        enabled: true,
        webhookUrl: resolved.slackWebhookUrl,
      });
      if (!slackRes.ok && slackRes.error !== "SLACK_NOT_CONFIGURED") {
        console.error("slack ko", slackRes);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("slack exception", message.slice(0, 500));
    }

    return jsonResponse(
      {
        ok: true,
        bookingId,
        isQuote: tariff.isQuote,
        price: tariff.isQuote ? null : Number(tariff.total),
      },
      { status: 200, headers: corsHeaders(request) },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("create-booking exception", message);
    return jsonResponse({ ok: false, error: "Internal error" }, { status: 500, headers: corsHeaders(request) });
  }
};

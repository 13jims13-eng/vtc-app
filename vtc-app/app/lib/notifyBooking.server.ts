import { createSupabaseServiceClientOptional } from "./supabase.server";
import { decryptSlackWebhookOptional } from "./driver.server";
import { buildBookingSummary, sendBookingEmailTo, sendSlackOptional } from "./bookingNotify.server";

export type BookingForNotify = {
  id: string;
  customer_name?: string | null;
  customer_phone?: string | null;
  pickup?: string | null;
  dropoff?: string | null;
  datetime?: string | null;
  price?: number | null;
  status?: string | null;
};

export async function notifyBooking(userId: string, booking: BookingForNotify) {
  const supabase = createSupabaseServiceClientOptional();
  if (!supabase) {
    return { ok: false as const, error: "SUPABASE_SECRET_KEY_MISSING" as const };
  }

  const settingsRes = await supabase
    .from("driver_settings")
    .select("booking_email_to,slack_webhook_url")
    .eq("user_id", userId)
    .maybeSingle();

  if (settingsRes.error) {
    return { ok: false as const, error: "DB_ERROR" as const, details: settingsRes.error.message };
  }

  const bookingEmailTo = (settingsRes.data as any)?.booking_email_to ? String((settingsRes.data as any).booking_email_to) : "";
  const slackEncrypted = (settingsRes.data as any)?.slack_webhook_url ? String((settingsRes.data as any).slack_webhook_url) : "";

  const summary = buildBookingSummary({
    contact: {
      name: booking.customer_name || "",
      phone: booking.customer_phone || "",
    },
    trip: {
      start: booking.pickup || "",
      end: booking.dropoff || "",
      pickupDate: booking.datetime || "",
      price: booking.price ?? undefined,
      isQuote: false,
    },
  });

  const emailRes = bookingEmailTo ? await sendBookingEmailTo(summary, bookingEmailTo) : { ok: false as const };

  const slackPlain = decryptSlackWebhookOptional(slackEncrypted);
  const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
  const allowFallback = ["1", "true", "yes"].includes(
    String(process.env.ALLOW_DEFAULT_SLACK_FALLBACK || "").trim().toLowerCase(),
  );
  const fallbackWebhook =
    !isProd && allowFallback ? String(process.env.DEFAULT_SLACK_WEBHOOK_URL || "").trim() : "";
  const webhookToUse = slackPlain || fallbackWebhook || null;

  const slackText = `Nouvelle réservation\n${summary.text}`;
  const slackRes = webhookToUse ? await sendSlackOptional(slackText, { webhookUrl: webhookToUse }) : { ok: false as const };

  return {
    ok: true as const,
    email: emailRes,
    slack: slackRes,
  };
}

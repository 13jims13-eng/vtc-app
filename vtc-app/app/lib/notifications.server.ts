import { createSupabaseServiceClientOptional } from "./supabase.server";

export type CreateNotificationInput = {
  recipientUserId?: string | null;
  recipientEmail?: string | null;
  bookingId?: string | null;
  title: string;
  body: string;
};

export async function createNotification(input: CreateNotificationInput) {
  const supabase = createSupabaseServiceClientOptional();
  if (!supabase) return { ok: false as const, error: "SUPABASE_SECRET_KEY_MISSING" as const };

  const recipient_user_id = input.recipientUserId || null;
  const recipient_email = input.recipientEmail || null;

  if (!recipient_user_id && !recipient_email) {
    return { ok: false as const, error: "RECIPIENT_REQUIRED" as const };
  }

  const res = await supabase.from("notifications").insert({
    recipient_user_id,
    recipient_email,
    booking_id: input.bookingId || null,
    title: input.title,
    body: input.body,
  });

  if (res.error) {
    return { ok: false as const, error: "DB_ERROR" as const, details: res.error.message };
  }

  return { ok: true as const };
}

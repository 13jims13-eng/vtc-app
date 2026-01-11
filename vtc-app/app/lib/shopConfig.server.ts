import { cleanText } from "./bookingNotify.server";
import { createSupabaseServiceClient } from "./supabase.server";
import { ensureTenant } from "./tenant.server";

export type ShopConfigData = {
  shop: string;
  bookingEmailTo: string | null;
};

export async function getShopConfig(shop: string): Promise<ShopConfigData | null> {
  const tenantKey = cleanText(shop).toLowerCase();
  if (!tenantKey) return null;

  const supabase = createSupabaseServiceClient();
  const res = await supabase
    .from("tenants")
    .select("tenant_key,booking_email_to")
    .eq("tenant_key", tenantKey)
    .maybeSingle();

  if (res.error || !res.data) return null;
  return {
    shop: String((res.data as any).tenant_key),
    bookingEmailTo: cleanText((res.data as any).booking_email_to) || null,
  };
}

export async function upsertShopConfig(input: {
  shop: string;
  bookingEmailTo: string | null;
}) {
  const tenantKey = cleanText(input.shop).toLowerCase();
  if (!tenantKey) throw new Error("shop is required");

  const ensured = await ensureTenant(tenantKey);
  const supabase = createSupabaseServiceClient();
  const update = await supabase
    .from("tenants")
    .update({ booking_email_to: input.bookingEmailTo || null })
    .eq("id", ensured.id)
    .select("tenant_key,booking_email_to")
    .maybeSingle();

  if (update.error || !update.data) {
    throw new Error(update.error?.message || "TENANT_UPDATE_FAILED");
  }

  return {
    shop: String((update.data as any).tenant_key),
    bookingEmailTo: cleanText((update.data as any).booking_email_to) || null,
  };
}

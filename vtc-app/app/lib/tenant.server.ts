import { cleanText, validateSlackWebhookUrl } from "./bookingNotify.server";
import { decryptSecret, encryptSecret } from "./encryption.server";
import { createSupabaseServiceClient } from "./supabase.server";
import type { TenantOption, TenantPricingConfig, TenantVehicle } from "./pricing.server";

export type TenantRecord = {
  id: string;
  slug: string;
  name: string;
};

export type TenantSettingsRecord = {
  tenant_id: string;
  booking_email_to: string | null;
  stop_fee: number | null;
  quote_message: string | null;
  pricing_behavior: string | null;
  lead_time_threshold_minutes: number | null;
  immediate_surcharge_enabled: boolean | null;
  immediate_base_delta_amount: number | null;
  immediate_base_delta_percent: number | null;
  immediate_total_delta_percent: number | null;
  options: unknown | null;
};

function normalizeTenantKeyFromShop(shopRaw: string) {
  let v = cleanText(shopRaw).toLowerCase();
  if (!v) return null;

  // Accepte https://myshop.myshopify.com
  if (v.startsWith("http://") || v.startsWith("https://")) {
    try {
      v = new URL(v).hostname.toLowerCase();
    } catch {
      // ignore
    }
  }

  // strip path if any
  v = v.split("/")[0] || "";

  if (!v.endsWith(".myshopify.com")) return null;
  return v;
}

// A) Multi-boutiques (Shopify): source = shop (myshopify.com)
export function getTenantKeyFromRequest(request: Request) {
  const url = new URL(request.url);
  const fromQuery = url.searchParams.get("shop");
  const fromHeader =
    request.headers.get("x-shopify-shop-domain") ||
    request.headers.get("x-shop-domain") ||
    request.headers.get("X-Shopify-Shop-Domain") ||
    request.headers.get("X-Shop-Domain");

  return normalizeTenantKeyFromShop(fromQuery || fromHeader || "");
}

export async function getTenantId(tenantKeyRaw: string) {
  const tenantKey = normalizeTenantKeyFromShop(tenantKeyRaw);
  if (!tenantKey) return null;

  const supabase = createSupabaseServiceClient();
  const res = await supabase.from("tenants").select("id").eq("tenant_key", tenantKey).maybeSingle();
  if (res.error || !res.data) return null;
  return String((res.data as any).id);
}

export async function ensureTenant(tenantKeyRaw: string) {
  const tenantKey = normalizeTenantKeyFromShop(tenantKeyRaw);
  if (!tenantKey) throw new Error("Invalid tenant key (shop)");

  const supabase = createSupabaseServiceClient();
  const upsert = await supabase
    .from("tenants")
    .upsert({ tenant_key: tenantKey }, { onConflict: "tenant_key" })
    .select("id,tenant_key")
    .maybeSingle();

  if (upsert.error || !upsert.data) {
    throw new Error(upsert.error?.message || "TENANT_UPSERT_FAILED");
  }

  return { id: String((upsert.data as any).id), tenantKey: String((upsert.data as any).tenant_key) };
}

export function maskSlackWebhookUrl(url: string) {
  const v = String(url || "").trim();
  if (!v) return "";
  // Keep prefix + last 6 chars.
  const prefix = "https://hooks.slack.com/services/";
  if (!v.startsWith(prefix)) return "(masqué)";
  const tail = v.slice(-6);
  return `${prefix}…${tail}`;
}

export function encryptSlackWebhookForStorage(webhookUrl: string) {
  const validation = validateSlackWebhookUrl(webhookUrl);
  if (!validation.ok) {
    return { ok: false as const, error: validation.reason };
  }

  const normalized = validation.normalized;
  return {
    ok: true as const,
    normalized,
    webhookEncrypted: encryptSecret(normalized),
    webhookMask: maskSlackWebhookUrl(normalized),
  };
}

export function decryptSlackWebhookFromStorage(encrypted: string) {
  const raw = decryptSecret(encrypted);
  const validation = validateSlackWebhookUrl(raw);
  if (!validation.ok) return null;
  return validation.normalized;
}

export async function getTenantRuntimeConfigBySlug(slugRaw: string): Promise<
  | {
      ok: true;
      tenant: TenantRecord;
      pricing: TenantPricingConfig;
      bookingEmailTo: string | null;
      slackWebhookUrl: string | null;
      slackWebhookMask: string | null;
    }
  | { ok: false; error: "TENANT_NOT_FOUND" | "CONFIG_NOT_FOUND" }
> {
  const slug = cleanText(slugRaw).toLowerCase();
  if (!slug) return { ok: false, error: "TENANT_NOT_FOUND" };

  const supabase = createSupabaseServiceClient();

  const tenantRes = await supabase
    .from("tenants")
    .select("id,slug,name")
    .eq("slug", slug)
    .maybeSingle();

  if (tenantRes.error || !tenantRes.data) {
    return { ok: false, error: "TENANT_NOT_FOUND" };
  }

  const tenant = tenantRes.data as TenantRecord;

  const settingsRes = await supabase
    .from("tenant_settings")
    .select(
      "tenant_id,booking_email_to,stop_fee,quote_message,pricing_behavior,lead_time_threshold_minutes,immediate_surcharge_enabled,immediate_base_delta_amount,immediate_base_delta_percent,immediate_total_delta_percent,options",
    )
    .eq("tenant_id", tenant.id)
    .maybeSingle();

  if (settingsRes.error || !settingsRes.data) {
    return { ok: false, error: "CONFIG_NOT_FOUND" };
  }

  const settings = settingsRes.data as TenantSettingsRecord;

  const vehiclesRes = await supabase
    .from("vehicles")
    .select("id,label,base_fare,price_per_km,quote_only,image_url")
    .eq("tenant_id", tenant.id)
    .order("created_at", { ascending: true });

  const vehicles: TenantVehicle[] = (vehiclesRes.data || [])
    .map((v: any) => ({
      id: cleanText(v.id),
      label: cleanText(v.label) || cleanText(v.id),
      baseFare: Number(v.base_fare || 0),
      pricePerKm: Number(v.price_per_km || 0),
      quoteOnly: !!v.quote_only || cleanText(v.id) === "autre",
      imageUrl: cleanText(v.image_url) || null,
    }))
    .filter((v) => !!v.id);

  const options: TenantOption[] = Array.isArray(settings.options)
    ? (settings.options as any[])
        .map((o) => ({
          id: cleanText(o?.id),
          label: cleanText(o?.label) || cleanText(o?.id),
          type: (String(o?.type || "fixed").toLowerCase() === "percent" ? "percent" : "fixed") as
            | "fixed"
            | "percent",
          amount: Number(o?.amount ?? o?.fee ?? 0),
        }))
        .filter((o) => !!o.id)
    : [];

  const pricingBehavior = (cleanText(settings.pricing_behavior) || "normal_prices") as any;

  const pricing: TenantPricingConfig = {
    stopFee: Number(settings.stop_fee || 0),
    quoteMessage: cleanText(settings.quote_message) || "Sur devis — merci de nous contacter.",
    pricingBehavior,
    leadTimeThresholdMinutes: Number(settings.lead_time_threshold_minutes ?? 120),
    immediateSurchargeEnabled: settings.immediate_surcharge_enabled !== false,
    immediateBaseDeltaAmount: Number(settings.immediate_base_delta_amount || 0),
    immediateBaseDeltaPercent: Number(settings.immediate_base_delta_percent || 0),
    immediateTotalDeltaPercent: Number(settings.immediate_total_delta_percent || 0),
    vehicles,
    options,
  };

  // Slack integration (single record expected for MVP)
  const slackRes = await supabase
    .from("tenant_integrations")
    .select("slack_webhook_enc,slack_webhook_encrypted,slack_webhook_mask,provider")
    .eq("tenant_id", tenant.id)
    .eq("provider", "slack")
    .maybeSingle();

  const slackWebhookMask = (slackRes.data as any)?.slack_webhook_mask ?? null;
  const encrypted =
    (slackRes.data as any)?.slack_webhook_enc ?? (slackRes.data as any)?.slack_webhook_encrypted ?? null;
  const slackWebhookUrl = encrypted ? decryptSlackWebhookFromStorage(String(encrypted)) : null;

  return {
    ok: true,
    tenant,
    pricing,
    bookingEmailTo: cleanText(settings.booking_email_to) || null,
    slackWebhookUrl,
    slackWebhookMask: cleanText(slackWebhookMask) || null,
  };
}

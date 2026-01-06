import { cleanText, validateSlackWebhookUrl } from "./bookingNotify.server";
import { decryptSecret, encryptSecret } from "./encryption.server";
import { createSupabaseServiceClient } from "./supabase.server";
import { ensureTenant } from "./tenant.server";

export type SlackConfigResolvedWebhook =
  | {
      ok: true;
      webhookUrl: string;
      source: "db" | "env";
      destinationKey: string | null;
      masked: string;
    }
  | { ok: false; source: "none"; destinationKey: string | null; masked: null };

function isProd() {
  return String(process.env.NODE_ENV || "").toLowerCase() === "production";
}

function allowDefaultSlackFallback() {
  const v = String(process.env.ALLOW_DEFAULT_SLACK_FALLBACK || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function maskSlackWebhookForLogs(url: string) {
  const v = cleanText(url);
  if (!v) return "disconnected";
  return `connected(…${v.slice(-6)})`;
}

export async function setSlackWebhookUrl(tenantId: string, urlRaw: string | null) {
  const tenant_id = cleanText(tenantId);
  if (!tenant_id) throw new Error("tenantId is required");

  const webhookRaw = cleanText(urlRaw);
  const supabase = createSupabaseServiceClient();

  if (!webhookRaw) {
    const del = await supabase.from("tenant_integrations").delete().eq("tenant_id", tenant_id);
    if (del.error) throw new Error(del.error.message);
    return { ok: true as const, connected: false as const, masked: null as string | null };
  }

  const validation = validateSlackWebhookUrl(webhookRaw);
  if (!validation.ok) {
    throw new Error(`Invalid Slack webhook: ${validation.reason}`);
  }

  const encrypted = encryptSecret(validation.normalized);
  const maskTail = validation.normalized.slice(-6);

  const upsert = await supabase
    .from("tenant_integrations")
    .upsert(
      {
        tenant_id,
        provider: "slack",
        slack_webhook_enc: encrypted,
        slack_webhook_encrypted: encrypted,
        slack_webhook_mask: maskTail,
        updated_at: new Date().toISOString(),
      } as any,
      { onConflict: "tenant_id" },
    );

  if (upsert.error) throw new Error(upsert.error.message);
  return { ok: true as const, connected: true as const, masked: `connected(…${maskTail})` };
}

export async function getSlackWebhookUrl(tenantId: string) {
  const tenant_id = cleanText(tenantId);
  if (!tenant_id) return null;

  const supabase = createSupabaseServiceClient();
  const res = await supabase
    .from("tenant_integrations")
    .select("slack_webhook_enc,slack_webhook_encrypted")
    .eq("tenant_id", tenant_id)
    .maybeSingle();

  const encrypted =
    cleanText((res.data as any)?.slack_webhook_enc) || cleanText((res.data as any)?.slack_webhook_encrypted);
  if (!encrypted) return null;

  try {
    const decrypted = decryptSecret(encrypted);
    const validation = validateSlackWebhookUrl(decrypted);
    if (!validation.ok) return null;
    return validation.normalized;
  } catch {
    return null;
  }
}

export async function getSlackStatusForShop(shop: string) {
  const tenantKey = cleanText(shop).toLowerCase();
  if (!tenantKey) return { connected: false as const, masked: null as string | null };

  const ensured = await ensureTenant(tenantKey);
  const webhook = await getSlackWebhookUrl(ensured.id);

  if (!webhook) return { connected: false as const, masked: null as string | null };
  return { connected: true as const, masked: maskSlackWebhookForLogs(webhook) };
}

export async function resolveSlackWebhookForShop(input: {
  shop: string;
  destinationKey?: string | null;
}): Promise<SlackConfigResolvedWebhook> {
  const shop = cleanText(input.shop).toLowerCase();
  const destinationKey = cleanText(input.destinationKey) || null;

  if (!shop) return { ok: false, source: "none", destinationKey, masked: null };

  const ensured = await ensureTenant(shop);
  const webhook = await getSlackWebhookUrl(ensured.id);

  if (webhook) {
    return {
      ok: true,
      webhookUrl: webhook,
      source: "db",
      destinationKey,
      masked: maskSlackWebhookForLogs(webhook),
    };
  }

  // DEV-only fallback explicitly gated; never in prod.
  if (!isProd() && allowDefaultSlackFallback()) {
    const fallback = cleanText(process.env.DEFAULT_SLACK_WEBHOOK_URL) || cleanText(process.env.SLACK_WEBHOOK_URL);
    if (fallback) {
      const validation = validateSlackWebhookUrl(fallback);
      if (validation.ok) {
        return {
          ok: true,
          webhookUrl: validation.normalized,
          source: "env",
          destinationKey,
          masked: maskSlackWebhookForLogs(validation.normalized),
        };
      }
    }
  }

  return { ok: false, source: "none", destinationKey, masked: null };
}

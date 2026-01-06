import { decryptSecret, encryptSecret } from "./encryption.server";
import { validateSlackWebhookUrl } from "./bookingNotify.server";

export type DriverProfile = {
  id: string;
  full_name: string | null;
  phone: string | null;
};

export type DriverSettingsPublic = {
  company_name: string | null;
  booking_email_to: string | null;
  theme_name: string | null;
  primary_color: string | null;
  logo_url: string | null;
  slack: { connected: boolean; last6: string | null };
};

export async function getDriverProfileAndSettings(supabase: any, userId: string) {
  const profileRes = await supabase.from("profiles").select("id,full_name,phone").eq("id", userId).maybeSingle();
  const settingsRes = await supabase
    .from("driver_settings")
    .select("company_name,booking_email_to,slack_webhook_url,theme_name,primary_color,logo_url")
    .eq("user_id", userId)
    .maybeSingle();

  const profile = (profileRes.data as any) || null;
  const settings = (settingsRes.data as any) || null;

  const encryptedWebhook = settings?.slack_webhook_url ? String(settings.slack_webhook_url) : "";
  const slackPlain = decryptSlackWebhookOptional(encryptedWebhook);
  const slack = {
    connected: Boolean(slackPlain),
    last6: slackPlain ? slackPlain.slice(-6) : null,
  };

  const settingsPublic: DriverSettingsPublic = {
    company_name: settings?.company_name ?? null,
    booking_email_to: settings?.booking_email_to ?? null,
    theme_name: settings?.theme_name ?? null,
    primary_color: settings?.primary_color ?? null,
    logo_url: settings?.logo_url ?? null,
    slack,
  };

  return {
    profile: profile
      ? ({ id: String(profile.id), full_name: profile.full_name ?? null, phone: profile.phone ?? null } satisfies DriverProfile)
      : null,
    settingsPublic,
    hasSettingsRow: Boolean(settings),
  };
}

export function isOnboardingComplete(profile: DriverProfile | null, settings: DriverSettingsPublic) {
  return Boolean((profile?.full_name || "").trim()) && Boolean((settings.company_name || "").trim());
}

export function encryptSlackWebhookForSettings(rawWebhookUrl: string) {
  const validation = validateSlackWebhookUrl(rawWebhookUrl);
  if (!validation.ok) {
    return { ok: false as const, error: validation.reason };
  }

  try {
    return { ok: true as const, encrypted: encryptSecret(validation.normalized), last6: validation.normalized.slice(-6) };
  } catch (e: any) {
    return { ok: false as const, error: String(e?.message || e) };
  }
}

export function decryptSlackWebhookOptional(encryptedOrPlain: string | null | undefined) {
  const raw = String(encryptedOrPlain || "").trim();
  if (!raw) return null;

  // Backward compat: si un webhook est stocké en clair (pas recommandé), on le supporte.
  if (raw.startsWith("https://hooks.slack.com/")) return raw;

  try {
    const decrypted = decryptSecret(raw);
    return decrypted.startsWith("https://hooks.slack.com/") ? decrypted : null;
  } catch {
    return null;
  }
}

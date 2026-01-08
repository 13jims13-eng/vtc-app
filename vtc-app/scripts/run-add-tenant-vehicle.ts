import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import { createSupabaseServiceClient } from "../app/lib/supabase.server";

function loadDotEnvIfPresent() {
  // Minimal .env loader (no external dependency). Only supports KEY=VALUE lines.
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;

  const raw = readFileSync(envPath, "utf8");
  for (const lineRaw of raw.split(/\r?\n/)) {
    const line = lineRaw.trim();
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq <= 0) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    // Remove optional quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) process.env[key] = value;
  }
}

function required(name: string) {
  const v = String(process.env[name] ?? "").trim();
  if (!v) throw new Error(`[seed:add-vehicle] Missing env: ${name}`);
  return v;
}

function arg(name: string) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

async function main() {
  loadDotEnvIfPresent();

  const tenantSlug = (arg("tenant") || process.env.TENANT_SLUG || "demo").trim().toLowerCase();
  const vehicleId = (arg("vehicle") || process.env.VEHICLE_ID || "berline").trim();

  const label = (arg("label") || process.env.VEHICLE_LABEL || "Berline").trim();
  const baseFare = Number(arg("baseFare") || process.env.VEHICLE_BASE_FARE || 10);
  const pricePerKm = Number(arg("pricePerKm") || process.env.VEHICLE_PRICE_PER_KM || 2);
  const quoteOnly = String(arg("quoteOnly") || process.env.VEHICLE_QUOTE_ONLY || "false").toLowerCase() === "true";

  // Ensure env is present (errors are clearer before instantiating client)
  required("SUPABASE_URL");
  // Supabase publishable key is required by getSupabasePublicConfig
  if (!process.env.SUPABASE_PUBLISHABLE_KEY && !process.env.SUPABASE_ANON_KEY) {
    throw new Error(`[seed:add-vehicle] Missing env: SUPABASE_PUBLISHABLE_KEY (or SUPABASE_ANON_KEY)`);
  }
  if (!process.env.SUPABASE_SECRET_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(`[seed:add-vehicle] Missing env: SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY)`);
  }

  const supabase = createSupabaseServiceClient();

  const tenantRes = await supabase.from("tenants").select("id,slug").eq("slug", tenantSlug).maybeSingle();
  if (tenantRes.error || !tenantRes.data) {
    throw new Error(`[seed:add-vehicle] Tenant not found for slug="${tenantSlug}"`);
  }

  const tenantId = String((tenantRes.data as any).id);

  const insertRes = await supabase
    .from("vehicles")
    .upsert(
      {
        id: vehicleId,
        tenant_id: tenantId,
        label,
        base_fare: Number.isFinite(baseFare) ? baseFare : 0,
        price_per_km: Number.isFinite(pricePerKm) ? pricePerKm : 0,
        quote_only: !!quoteOnly,
        image_url: null,
      },
      { onConflict: "id" },
    )
    .select("id,tenant_id,label,base_fare,price_per_km,quote_only")
    .maybeSingle();

  if (insertRes.error) {
    throw new Error(`[seed:add-vehicle] Insert failed: ${insertRes.error.message}`);
  }

  const v = insertRes.data as any;
  console.log("OK");
  console.log({ tenantSlug, tenantId, vehicle: { id: v.id, label: v.label, baseFare: v.base_fare, pricePerKm: v.price_per_km, quoteOnly: v.quote_only } });
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(msg);
  process.exitCode = 1;
});

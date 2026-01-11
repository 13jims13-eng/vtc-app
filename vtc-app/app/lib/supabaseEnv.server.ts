function requiredEnv(name: string) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) throw new Error(`[config] Missing env: ${name}`);
  return value;
}

function requiredEnvAny(names: string[]) {
  for (const name of names) {
    const value = String(process.env[name] ?? "").trim();
    if (value) return value;
  }
  throw new Error(`[config] Missing env (any of): ${names.join(", ")}`);
}

function optionalEnvAny(names: string[]) {
  for (const name of names) {
    const value = String(process.env[name] ?? "").trim();
    if (value) return value;
  }
  return null;
}

export function getSupabasePublicConfig() {
  return {
    url: requiredEnv("SUPABASE_URL"),
    // Nouveau nom (recommandé) : SUPABASE_PUBLISHABLE_KEY
    // Compat : SUPABASE_ANON_KEY (ancien)
    publishableKey: requiredEnvAny(["SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY"]),
  };
}

export function getSupabaseSecretKeyOptional() {
  // Nouveau nom (recommandé) : SUPABASE_SECRET_KEY
  // Compat : SUPABASE_SERVICE_ROLE_KEY (ancien)
  return optionalEnvAny(["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"]);
}

export function getSupabaseSecretKeyRequired() {
  return requiredEnvAny(["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"]);
}

export function getPublicEnvForClient() {
  const { url, publishableKey } = getSupabasePublicConfig();
  return {
    SUPABASE_URL: url,
    SUPABASE_PUBLISHABLE_KEY: publishableKey,
  };
}

const REQUIRED = [
  "APP_URL",
  "SHOPIFY_API_KEY",
  "SHOPIFY_API_SECRET",
  "SCOPES",
  "DATABASE_URL",
  // Supabase (données)
  "SUPABASE_URL",
  // Compat : SUPABASE_ANON_KEY (ancien)
  "SUPABASE_PUBLISHABLE_KEY",
  // Service role (server-only). Compat : SUPABASE_SERVICE_ROLE_KEY (ancien)
  "SUPABASE_SECRET_KEY",
];

const OPTIONAL = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_USER",
  "SMTP_PASS",
  "BOOKING_EMAIL_FROM",
  "BOOKING_EMAIL_TO",
  // Chiffrement (Slack secrets)
  "ENCRYPTION_KEY",
  "CONFIG_ENCRYPTION_KEY",
  // DEV fallback only (Slack config should live in DB, encrypted)
  "ALLOW_DEFAULT_SLACK_FALLBACK",
  "DEFAULT_SLACK_WEBHOOK_URL",
  "SLACK_WEBHOOK_URL",
];

function isTruthy(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function getEnvAny(keys) {
  for (const k of keys) {
    if (isTruthy(process.env[k])) return process.env[k];
  }
  return "";
}

const missingRequired = REQUIRED.filter((k) => !isTruthy(process.env[k]));

// Compat keys mapping checks
const supabasePublishable = getEnvAny(["SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY"]);
const supabaseSecret = getEnvAny(["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"]);
const encryptionKey = getEnvAny(["ENCRYPTION_KEY", "CONFIG_ENCRYPTION_KEY"]);

const missingSupabasePublishable = !isTruthy(supabasePublishable);
const missingSupabaseSecret = !isTruthy(supabaseSecret);

const missingOptionalEmailGroup = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_USER",
  "SMTP_PASS",
  "BOOKING_EMAIL_FROM",
  "BOOKING_EMAIL_TO",
].filter((k) => !isTruthy(process.env[k]));

console.log("[setup:prod] Vérification variables d'env (valeurs masquées)");
console.log("- NODE_ENV:", process.env.NODE_ENV || "(absent)");
console.log("- APP_URL:", isTruthy(process.env.APP_URL) ? "(ok)" : "(manquant)");

if (missingRequired.length) {
  console.error("\nVariables REQUIRED manquantes:");
  for (const k of missingRequired) console.error(`- ${k}`);
} else {
  console.log("\nVariables REQUIRED: OK");
}

console.log("\nSupabase:");
console.log("- SUPABASE_URL:", isTruthy(process.env.SUPABASE_URL) ? "(ok)" : "(manquant)");
console.log(
  "- SUPABASE_PUBLISHABLE_KEY (ou SUPABASE_ANON_KEY):",
  missingSupabasePublishable ? "(manquant)" : "(ok)",
);
console.log(
  "- SUPABASE_SECRET_KEY (ou SUPABASE_SERVICE_ROLE_KEY):",
  missingSupabaseSecret ? "(manquant)" : "(ok)",
);

if (missingOptionalEmailGroup.length === 0) {
  console.log("Email: configuré (SMTP + BOOKING_EMAIL_*)");
} else {
  console.log("Email: non configuré (OK si vous n'envoyez pas d'emails en prod)");
  console.log("Manquants (email):");
  for (const k of missingOptionalEmailGroup) console.log(`- ${k}`);
}

console.log(
  "Slack (chiffrement):",
  isTruthy(encryptionKey) ? "ENCRYPTION_KEY/CONFIG_ENCRYPTION_KEY=(ok)" : "ENCRYPTION_KEY/CONFIG_ENCRYPTION_KEY=(manquant)",
);
console.log(
  "Slack (fallback dev):",
  isTruthy(process.env.ALLOW_DEFAULT_SLACK_FALLBACK) &&
    (isTruthy(process.env.DEFAULT_SLACK_WEBHOOK_URL) || isTruthy(process.env.SLACK_WEBHOOK_URL))
    ? "(configuré)"
    : "(désactivé)",
);

console.log("\nRappels Shopify / Render:");
console.log("1) Render: déployer et obtenir l'URL stable.");
console.log("2) Local: synchroniser shopify.app.toml: APP_URL=... npm run sync:shopify-url");
console.log("3) Shopify CLI: shopify app deploy (met à jour App URL + Redirect URLs côté Shopify).\n");
console.log("App Proxy attendu:");
console.log("- Sur la boutique: POST /apps/vtc/api/booking-notify");
console.log("- Côté app: route /apps/vtc/api/booking-notify (validée par signature App Proxy)\n");

if (missingRequired.length) {
  process.exit(1);
}

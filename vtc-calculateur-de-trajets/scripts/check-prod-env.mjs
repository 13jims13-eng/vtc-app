const REQUIRED = [
  "APP_URL",
  "SHOPIFY_API_KEY",
  "SHOPIFY_API_SECRET",
  "SCOPES",
  "DATABASE_URL",
];

const OPTIONAL = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_USER",
  "SMTP_PASS",
  "BOOKING_EMAIL_FROM",
  "BOOKING_EMAIL_TO",
  "CONFIG_ENCRYPTION_KEY",
  // DEV fallback only (Slack config should live in DB, encrypted)
  "SLACK_WEBHOOK_URL",
];

function isTruthy(value) {
  return typeof value === "string" && value.trim().length > 0;
}

const missingRequired = REQUIRED.filter((k) => !isTruthy(process.env[k]));

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

if (missingOptionalEmailGroup.length === 0) {
  console.log("Email: configuré (SMTP + BOOKING_EMAIL_*)");
} else {
  console.log("Email: non configuré (OK si vous n'envoyez pas d'emails en prod)");
  console.log("Manquants (email):");
  for (const k of missingOptionalEmailGroup) console.log(`- ${k}`);
}

console.log(
  "Slack (chiffrement):",
  isTruthy(process.env.CONFIG_ENCRYPTION_KEY) ? "CONFIG_ENCRYPTION_KEY=(ok)" : "CONFIG_ENCRYPTION_KEY=(manquant)",
);
console.log(
  "Slack (fallback dev):",
  isTruthy(process.env.SLACK_WEBHOOK_URL) ? "SLACK_WEBHOOK_URL=(présent)" : "SLACK_WEBHOOK_URL=(absent)",
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

// Client test: calls the Shopify App Proxy booking-notify endpoint from the storefront URL.
// Usage:
//   node scripts/run-booking-notify-client-test.mjs
//   SHOP_URL=vtc-dev.myshopify.com node scripts/run-booking-notify-client-test.mjs
//   PROXY_PATH=/apps/vtc/api/booking-notify node scripts/run-booking-notify-client-test.mjs
//   MODE=POST node scripts/run-booking-notify-client-test.mjs
//   COOKIE="storefront_digest=...;" MODE=POST node scripts/run-booking-notify-client-test.mjs
//
// Notes:
// - If EMAIL is not configured server-side, you should get 500 { ok:false, error:"EMAIL_NOT_CONFIGURED" }.
// - Slack is optional; if it fails but email succeeds, you should still get 200 { ok:true, ... }.

const shopUrl = process.env.SHOP_URL || "vtc-dev.myshopify.com";
const proxyPath = process.env.PROXY_PATH || "/apps/vtc/api/booking-notify";
const mode = (process.env.MODE || "POST").toUpperCase();
const cookie = process.env.COOKIE || "";

const baseUrl = `https://${shopUrl}${proxyPath}`;

function printResponse(prefix, res, bodyText) {
  console.log(`${prefix} STATUS`, res.status);
  const ct = res.headers.get("content-type");
  if (ct) console.log(`${prefix} Content-Type`, ct);

  const looksLikePasswordPage =
    (ct && ct.includes("text/html")) ||
    /This store is password protected/i.test(bodyText) ||
    /Enter store password/i.test(bodyText);

  if (looksLikePasswordPage) {
    console.log(
      `${prefix} NOTE La boutique est protégée par mot de passe: Shopify renvoie la page /password au lieu d'exécuter l'App Proxy.`,
    );
    console.log(
      `${prefix} NOTE Pour tester via script: désactive temporairement le mot de passe (Online Store > Preferences > Password protection), puis relance ce script.`,
    );
    console.log(
      `${prefix} NOTE Alternative: passe le cookie via env var COOKIE (ex: COOKIE="storefront_digest=...;") pour simuler une session navigateur.`,
    );
  }

  console.log(`${prefix} BODY`, bodyText);
}

async function doPost() {
  console.log("POST", baseUrl);

  const payload = {
    contact: {
      name: "Client Test",
      email: "client-test@example.com",
      phone: "0600000000",
    },
    trip: {
      start: "Point A",
      end: "Point B",
      stops: [],
      pickupDate: "2025-12-13",
      pickupTime: "10:00",
      vehicle: "berline",
      isQuote: false,
      price: 45.5,
      distanceKm: 12.4,
      durationMinutes: 18,
      petOption: false,
      babySeatOption: false,
      customOption: "",
    },
    consents: {
      termsConsent: true,
      marketingConsent: false,
    },
  };

  const res = await fetch(baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/plain, */*",
      ...(cookie ? { Cookie: cookie } : null),
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  printResponse("POST", res, text);
}

async function main() {
  if (mode !== "POST") {
    console.error("Only MODE=POST is supported for booking-notify.");
    process.exit(2);
  }

  await doPost();
}

main().catch((err) => {
  console.error("ERR", err);
  process.exit(1);
});

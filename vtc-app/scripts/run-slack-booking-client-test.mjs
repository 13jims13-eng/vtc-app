// Client test: calls the Shopify App Proxy endpoint from the storefront URL.
// Usage:
//   node scripts/run-slack-booking-client-test.mjs
//   SHOP_URL=vtc-dev.myshopify.com node scripts/run-slack-booking-client-test.mjs
//   PROXY_PATH=/apps/vtc/api/booking-notify node scripts/run-slack-booking-client-test.mjs
//   MODE=GET node scripts/run-slack-booking-client-test.mjs
//   COOKIE="storefront_digest=...;" MODE=POST node scripts/run-slack-booking-client-test.mjs
//
// Notes:
// - Default endpoint is booking-notify (email mandatory; Slack optional).
// - To test the legacy Slack-only endpoint, set PROXY_PATH=/apps/vtc/api/slack-booking.

const shopUrl = process.env.SHOP_URL || "vtc-dev.myshopify.com";
const proxyPath = process.env.PROXY_PATH || "/apps/vtc/api/booking-notify";
const mode = (process.env.MODE || "BOTH").toUpperCase();
const cookie = process.env.COOKIE || "";

const baseUrl = `https://${shopUrl}${proxyPath}`;

function printResponse(prefix, res, bodyText) {
  console.log(`${prefix} STATUS`, res.status);
  const ct = res.headers.get("content-type");
  if (ct) console.log(`${prefix} Content-Type`, ct);
  const location = res.headers.get("location");
  if (location) console.log(`${prefix} Location`, location);

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

async function doGet() {
  console.log("GET", baseUrl);
  const res = await fetch(baseUrl, {
    method: "GET",
    headers: {
      Accept: "application/json, text/plain, */*",
      ...(cookie ? { Cookie: cookie } : null),
    },
  });
  const text = await res.text();
  printResponse("GET", res, text);
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
  if (mode === "GET") return doGet();
  if (mode === "POST") return doPost();

  await doGet();
  console.log("---");
  await doPost();
}

main().catch((err) => {
  console.error("ERR", err);
  process.exit(1);
});

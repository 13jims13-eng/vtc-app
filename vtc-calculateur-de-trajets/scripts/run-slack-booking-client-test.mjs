// Client test: calls the Shopify App Proxy endpoint from the storefront URL.
// Usage:
//   node scripts/run-slack-booking-client-test.mjs
//   SHOP_URL=vtc-dev.myshopify.com node scripts/run-slack-booking-client-test.mjs
//   PROXY_PATH=/apps/vtc/slack-booking node scripts/run-slack-booking-client-test.mjs
//   MODE=GET node scripts/run-slack-booking-client-test.mjs

const shopUrl = process.env.SHOP_URL || "vtc-dev.myshopify.com";
const proxyPath = process.env.PROXY_PATH || "/apps/vtc/api/slack-booking";
const mode = (process.env.MODE || "BOTH").toUpperCase();

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
      `${prefix} NOTE Depuis le navigateur, si tu as déjà saisi le mot de passe, le widget pourra appeler /apps/vtc/... car le cookie est présent.`,
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

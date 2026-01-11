const baseUrl = process.env.BASE_URL || "http://localhost:3000";
const slugs = (process.env.TENANT_SLUGS || process.env.TENANT_SLUG || "demo")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

async function main() {
  const url = `${baseUrl}/create-booking`;

  for (const slug of slugs) {
    const body = {
      slug,
      contact: {
        name: "Test Client",
        email: "test@example.com",
        phone: "+33600000000",
      },
      trip: {
        start: "Gare Saint-Charles, Marseille",
        end: "Aéroport Marseille Provence",
        stops: ["Vieux-Port, Marseille"],
        pickupDate: new Date().toISOString().slice(0, 10),
        pickupTime: "10:00",
        distanceKm: 25.4,
        durationMinutes: 32,
        vehicleId: "berline",
        optionIds: [],
        customOption: "",
      },
      consents: {
        termsConsent: true,
        marketingConsent: false,
      },
    };

    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const text = await resp.text();
    console.log("---");
    console.log("TENANT", slug);
    console.log(resp.status, resp.statusText);
    console.log(text);

    if (!resp.ok) process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

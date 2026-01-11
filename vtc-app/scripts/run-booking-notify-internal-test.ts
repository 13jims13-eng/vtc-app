import type { ActionFunctionArgs } from "react-router";
import { action as bookingNotifyAction } from "../app/routes/api.booking-notify";

async function main() {
  const payload = {
    contact: {
      name: "Test User",
      email: "test@example.com",
      phone: "0123456789",
    },
    trip: {
      start: "Point A",
      end: "Point B",
      stops: [],
      pickupDate: "2025-12-14",
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
    // Optional (non-secret): can override the email recipient configured in env
    // config: { bookingEmailTo: "driver@example.com" },
  };

  const request = new Request("http://internal.test/api/booking-notify", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const res = await bookingNotifyAction({ request } as unknown as ActionFunctionArgs);
  const text = await res.text();

  // eslint-disable-next-line no-console
  console.log("STATUS", res.status);
  // eslint-disable-next-line no-console
  console.log(text);

  if (!res.ok) process.exit(1);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});

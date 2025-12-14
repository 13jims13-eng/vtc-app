import type { ActionFunctionArgs } from "react-router";
import { action as slackBookingAction } from "../app/routes/api.slack-booking";

async function main() {
  const channelId = process.env.SLACK_CHANNEL_ID || "C0A3AH5M4QY";

  const payload = {
    slack: { channelId },
    contact: {
      name: "Test User",
      email: "test@example.com",
      phone: "0123456789",
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

  const request = new Request("http://internal.test/api/slack-booking", {
    method: "POST",
    headers: {
      Origin: "http://internal.test",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const res = await slackBookingAction({ request } as unknown as ActionFunctionArgs);
  const text = await res.text();

  // eslint-disable-next-line no-console
  console.log("STATUS", res.status);
  // eslint-disable-next-line no-console
  console.log(text);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});

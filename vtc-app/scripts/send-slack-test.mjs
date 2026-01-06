// Sends a test message to Slack using an Incoming Webhook.
// Usage (PowerShell):
//   $env:SLACK_WEBHOOK_URL='https://hooks.slack.com/services/...'; node scripts/send-slack-test.mjs
// Optional:
//   $env:SLACK_TEST_TEXT='hello'; node scripts/send-slack-test.mjs

const webhook = (process.env.SLACK_WEBHOOK_URL || "").trim();
if (!webhook) {
  console.error("Missing SLACK_WEBHOOK_URL. Create vtc-calculateur-de-trajets/.env from .env.example.");
  process.exit(1);
}

const text = (process.env.SLACK_TEST_TEXT || "").trim() || `Test Slack OK - ${new Date().toISOString()}`;

async function main() {
  console.log("POST Slack Incoming Webhook (redacted)");

  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  const body = await res.text().catch(() => "");
  console.log("STATUS", res.status);
  if (!res.ok) {
    console.error("Slack webhook failed:", body);
    process.exit(1);
  }

  console.log("OK", body || "(empty)");
}

main().catch((err) => {
  console.error("ERR", err);
  process.exit(1);
});

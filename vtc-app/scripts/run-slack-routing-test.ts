import { ensureTenant } from "../app/lib/tenant.server";
import { resolveSlackWebhookForShop, setSlackWebhookUrl } from "../app/lib/slackConfig.server";

function requireEnv(name: string) {
  const v = String(process.env[name] || "").trim();
  if (!v) throw new Error(`${name} is required`);
  return v;
}

async function main() {
  // Required for Supabase + encryption
  requireEnv("SUPABASE_URL");
  requireEnv("SUPABASE_SECRET_KEY");
  requireEnv("ENCRYPTION_KEY");

  // Two shops (tenants)
  const shopA = (process.env.SHOP_A || "shop-a.myshopify.com").trim().toLowerCase();
  const shopB = (process.env.SHOP_B || "shop-b.myshopify.com").trim().toLowerCase();

  // Fake-but-well-formed Slack webhooks for testing (must match validateSlackWebhookUrl)
  const webhookA =
    (process.env.WEBHOOK_A || "https://hooks.slack.com/services/T00000000/B00000000/AAAAAAAAAAAAAAAAAAAA").trim();
  const webhookB =
    (process.env.WEBHOOK_B || "https://hooks.slack.com/services/T00000000/B00000000/BBBBBBBBBBBBBBBBBBBB").trim();

  // Make sure env fallback is OFF for this test
  process.env.ALLOW_DEFAULT_SLACK_FALLBACK = "false";
  process.env.DEFAULT_SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/T00000000/B00000000/ENVENVENVENVENVENVENV";

  const tA = await ensureTenant(shopA);
  const tB = await ensureTenant(shopB);

  await setSlackWebhookUrl(tA.id, webhookA);
  await setSlackWebhookUrl(tB.id, webhookB);

  const rA = await resolveSlackWebhookForShop({ shop: shopA });
  const rB = await resolveSlackWebhookForShop({ shop: shopB });

  console.log("A", { shop: shopA, ok: rA.ok, source: rA.ok ? rA.source : rA.source, masked: rA.ok ? rA.masked : null });
  console.log("B", { shop: shopB, ok: rB.ok, source: rB.ok ? rB.source : rB.source, masked: rB.ok ? rB.masked : null });

  if (!rA.ok || rA.source !== "db") throw new Error("Expected shop A to resolve from DB");
  if (!rB.ok || rB.source !== "db") throw new Error("Expected shop B to resolve from DB");
  if (rA.webhookUrl !== webhookA) throw new Error("Shop A webhook mismatch");
  if (rB.webhookUrl !== webhookB) throw new Error("Shop B webhook mismatch");

  // Clear B and verify no env fallback
  await setSlackWebhookUrl(tB.id, null);
  const rB2 = await resolveSlackWebhookForShop({ shop: shopB });
  console.log("B after clear", { ok: rB2.ok, source: rB2.source });
  if (rB2.ok) throw new Error("Expected shop B to be not configured after clear");

  console.log("OK");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

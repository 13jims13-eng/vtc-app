import db from "../db.server";
import { decryptSecret, encryptSecret } from "./encryption.server";
import { cleanText, validateSlackWebhookUrl } from "./bookingNotify.server";

export type SlackDestinationKey = "devis" | "reservations" | "support";

export type SlackConfigResolvedWebhook =
  | { ok: true; webhookUrl: string; source: "db" | "env"; destinationKey: string | null }
  | { ok: false; source: "none"; destinationKey: string | null };

export async function upsertSlackDestinations(input: {
  shop: string;
  defaultDestinationKey: SlackDestinationKey | "" | null;
  destinations: Array<{ key: SlackDestinationKey; name: string; webhookUrl: string | "" }>;
}) {
  const shop = cleanText(input.shop);
  if (!shop) throw new Error("shop is required");

  const defaultKey = (cleanText(input.defaultDestinationKey) || null) as SlackDestinationKey | null;

  const rows = input.destinations.map((d) => {
    const key = d.key;
    const name = cleanText(d.name) || key;
    const webhookRaw = cleanText(d.webhookUrl);

    if (!webhookRaw) {
      return { key, name, webhookEncrypted: null as string | null };
    }

    const validation = validateSlackWebhookUrl(webhookRaw);
    if (!validation.ok) {
      throw new Error(`Invalid Slack webhook for destination: ${key}`);
    }

    return { key, name, webhookEncrypted: encryptSecret(validation.normalized) };
  });

  await db.$transaction(async (tx) => {
    await tx.slackConfig.upsert({
      where: { shop },
      create: { shop, defaultDestinationKey: defaultKey },
      update: { defaultDestinationKey: defaultKey },
    });

    for (const row of rows) {
      if (!row.webhookEncrypted) {
        await tx.slackDestination.deleteMany({ where: { shop, key: row.key } });
        continue;
      }

      await tx.slackDestination.upsert({
        where: { shop_key: { shop, key: row.key } },
        create: {
          shop,
          key: row.key,
          name: row.name,
          webhookEncrypted: row.webhookEncrypted,
        },
        update: {
          name: row.name,
          webhookEncrypted: row.webhookEncrypted,
        },
      });
    }
  });
}

export async function getSlackConfigForShop(shop: string) {
  const s = cleanText(shop);
  if (!s) return null;

  return db.slackConfig.findUnique({
    where: { shop: s },
    include: { destinations: true },
  });
}

export async function resolveSlackWebhookForShop(input: {
  shop: string;
  destinationKey?: string | null;
}): Promise<SlackConfigResolvedWebhook> {
  const shop = cleanText(input.shop);
  const requestedKey = cleanText(input.destinationKey) || null;

  if (!shop) return { ok: false, source: "none", destinationKey: requestedKey };

  const config = await db.slackConfig.findUnique({
    where: { shop },
    include: { destinations: true },
  });

  const pickKey = requestedKey || (config?.defaultDestinationKey ?? null);

  const dest =
    pickKey && config?.destinations?.length
      ? config.destinations.find((d) => d.key === pickKey) || null
      : null;

  if (dest?.webhookEncrypted) {
    try {
      const webhookUrl = decryptSecret(dest.webhookEncrypted);
      // validate lightly post-decrypt, without throwing on weird legacy values
      const validation = validateSlackWebhookUrl(webhookUrl);
      if (validation.ok) {
        return { ok: true, webhookUrl: validation.normalized, source: "db", destinationKey: pickKey };
      }
    } catch {
      // Do not leak details.
    }
  }

  // DEV-only fallback: allow SLACK_WEBHOOK_URL when no DB config.
  const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
  if (!isProd) {
    const env = cleanText(process.env.SLACK_WEBHOOK_URL);
    if (env) {
      const validation = validateSlackWebhookUrl(env);
      if (validation.ok) {
        return { ok: true, webhookUrl: validation.normalized, source: "env", destinationKey: pickKey };
      }
    }
  }

  return { ok: false, source: "none", destinationKey: pickKey };
}

import db from "../db.server";

export type ShopConfigData = {
  shop: string;
  bookingEmailTo: string | null;
  slackWebhookUrl: string | null;
};

export async function getShopConfig(shop: string): Promise<ShopConfigData | null> {
  // NOTE: Prisma client is generated at install/build time.
  // Some editor/diagnostic pipelines can lag behind the generated types.
  // Cast to keep runtime correct and avoid false-positive TS errors.
  const prisma = db as unknown as {
    shopConfig: {
      findUnique: typeof db["session"]["findUnique"];
      upsert: typeof db["session"]["upsert"];
    };
  };

  const row = await prisma.shopConfig.findUnique({
    where: { shop },
    select: { shop: true, bookingEmailTo: true, slackWebhookUrl: true },
  });

  return row
    ? {
        shop: row.shop,
        bookingEmailTo: row.bookingEmailTo,
        slackWebhookUrl: row.slackWebhookUrl,
      }
    : null;
}

export async function upsertShopConfig(input: {
  shop: string;
  bookingEmailTo: string | null;
  slackWebhookUrl: string | null;
}) {
  const prisma = db as unknown as {
    shopConfig: {
      upsert: typeof db["session"]["upsert"];
    };
  };

  return prisma.shopConfig.upsert({
    where: { shop: input.shop },
    create: {
      shop: input.shop,
      bookingEmailTo: input.bookingEmailTo,
      slackWebhookUrl: input.slackWebhookUrl,
    },
    update: {
      bookingEmailTo: input.bookingEmailTo,
      slackWebhookUrl: input.slackWebhookUrl,
    },
    select: { shop: true, bookingEmailTo: true, slackWebhookUrl: true },
  });
}

import db from "../db.server";

export type ShopConfigData = {
  shop: string;
  bookingEmailTo: string | null;
};

export async function getShopConfig(shop: string): Promise<ShopConfigData | null> {
  const row = await db.shopConfig.findUnique({
    where: { shop },
    select: { shop: true, bookingEmailTo: true },
  });

  return row
    ? {
        shop: row.shop,
        bookingEmailTo: row.bookingEmailTo,
      }
    : null;
}

export async function upsertShopConfig(input: {
  shop: string;
  bookingEmailTo: string | null;
}) {
  return db.shopConfig.upsert({
    where: { shop: input.shop },
    create: {
      shop: input.shop,
      bookingEmailTo: input.bookingEmailTo,
    },
    update: {
      bookingEmailTo: input.bookingEmailTo,
    },
    select: { shop: true, bookingEmailTo: true },
  });
}

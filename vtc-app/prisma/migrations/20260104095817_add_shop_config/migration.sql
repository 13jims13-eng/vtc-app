-- CreateTable
CREATE TABLE "ShopConfig" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "bookingEmailTo" TEXT,
    "slackWebhookUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

/*
  Warnings:

  - You are about to drop the column `slackWebhookUrl` on the `ShopConfig` table. All the data in the column will be lost.

*/
-- CreateTable
CREATE TABLE "SlackConfig" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "defaultDestinationKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SlackDestination" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "webhookEncrypted" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SlackDestination_shop_fkey" FOREIGN KEY ("shop") REFERENCES "SlackConfig" ("shop") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ShopConfig" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "bookingEmailTo" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_ShopConfig" ("bookingEmailTo", "createdAt", "shop", "updatedAt") SELECT "bookingEmailTo", "createdAt", "shop", "updatedAt" FROM "ShopConfig";
DROP TABLE "ShopConfig";
ALTER TABLE "new_ShopConfig" RENAME TO "ShopConfig";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "SlackDestination_shop_idx" ON "SlackDestination"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "SlackDestination_shop_key_key" ON "SlackDestination"("shop", "key");

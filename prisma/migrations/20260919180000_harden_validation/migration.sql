-- CreateEnum
CREATE TYPE "DiscoveryProvider" AS ENUM ('fixture', 'devin');

-- CreateEnum
CREATE TYPE "DiscoveryOutcome" AS ENUM ('proposed', 'cannot_assess', 'needs_setup');

-- AlterTable
ALTER TABLE "DiscoveryRun"
ALTER COLUMN "provider" TYPE "DiscoveryProvider"
USING "provider"::"DiscoveryProvider",
ALTER COLUMN "outcome" TYPE "DiscoveryOutcome"
USING CASE
  WHEN "outcome" IS NULL THEN NULL
  ELSE "outcome"::"DiscoveryOutcome"
END;

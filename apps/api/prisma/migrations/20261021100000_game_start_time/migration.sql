ALTER TABLE "Event" RENAME COLUMN "firstWhistle" TO "gameStartTime";
ALTER TABLE "RoundPlan" RENAME COLUMN "firstWhistle" TO "gameStartTime";
ALTER TABLE "Event" DROP COLUMN "lastWhistle";

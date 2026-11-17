BEGIN;

-- Do not silently remove pre-existing relationships to install a constraint.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM "coach_athlete"
    GROUP BY "user_id", "athlete_id" HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate coach-athlete links need an operator-reviewed repair before this migration';
  END IF;
END $$;

CREATE TYPE "coach_invitation_purpose" AS ENUM ('PERSONAL', 'COLLEAGUE', 'SHARE', 'TRANSFER');

ALTER TABLE "athlete_invitation" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "coach_invitation"
  ALTER COLUMN "email" DROP NOT NULL,
  ADD COLUMN "purpose" "coach_invitation_purpose" NOT NULL DEFAULT 'PERSONAL',
  ADD COLUMN "athlete_ids" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];

CREATE UNIQUE INDEX "coach_athlete_user_id_athlete_id_key"
  ON "coach_athlete"("user_id", "athlete_id");

COMMIT;

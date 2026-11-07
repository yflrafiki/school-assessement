-- A system admin sees every school (read-only) and belongs to none.
ALTER TYPE "Role" ADD VALUE 'SYSTEM_ADMIN';

ALTER TABLE "users" ALTER COLUMN "school_id" DROP NOT NULL;

-- Everyone else must belong to a school, and a system admin never does. Compared as text,
-- because the new enum value cannot be used in the transaction that adds it.
ALTER TABLE "users" ADD CONSTRAINT "users_school_matches_role"
  CHECK (("role"::text = 'SYSTEM_ADMIN') = ("school_id" IS NULL));

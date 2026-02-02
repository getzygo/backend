-- Add has_used_trial column to users table
-- This tracks whether a user has ever used their free trial period
ALTER TABLE "users" ADD COLUMN "has_used_trial" boolean DEFAULT false NOT NULL;

-- Backfill: Mark all existing tenant owners as having used their trial
-- Any user who owns a tenant has already used their trial opportunity
UPDATE "users"
SET "has_used_trial" = true, "updated_at" = NOW()
WHERE "id" IN (
  SELECT DISTINCT "user_id"
  FROM "tenant_members"
  WHERE "is_owner" = true AND "status" = 'active'
);
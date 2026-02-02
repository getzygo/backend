-- Add avatar_source field to track avatar priority (upload > oauth)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatar_source" varchar(10);

-- Set existing avatars to 'oauth' if they have external URLs, 'upload' if internal
UPDATE "users"
SET "avatar_source" = CASE
  WHEN "avatar_url" LIKE 'http%' THEN 'oauth'
  WHEN "avatar_url" IS NOT NULL THEN 'upload'
  ELSE NULL
END
WHERE "avatar_source" IS NULL AND "avatar_url" IS NOT NULL;

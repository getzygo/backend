-- Add title, job_title, and reporting_manager_id to users table
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "title" varchar(20);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "job_title" varchar(100);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "reporting_manager_id" uuid REFERENCES "users"("id") ON DELETE SET NULL;

-- Create index for reporting manager lookups
CREATE INDEX IF NOT EXISTS "idx_users_reporting_manager" ON "users"("reporting_manager_id");

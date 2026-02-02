-- Add address fields to users table
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "state" varchar(100);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "state_code" varchar(10);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "address_line_1" varchar(255);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "address_line_2" varchar(255);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "postal_code" varchar(20);

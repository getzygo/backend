ALTER TABLE "tenants" ADD COLUMN "billing_email" varchar(255);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "billing_address" varchar(255);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "billing_city" varchar(100);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "billing_state" varchar(100);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "billing_postal_code" varchar(20);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "billing_country" varchar(2);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "company_legal_name" varchar(200);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "tax_id" varchar(50);
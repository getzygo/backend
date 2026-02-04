ALTER TABLE "tenant_members" ADD COLUMN "suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenant_members" ADD COLUMN "suspended_by" uuid;--> statement-breakpoint
ALTER TABLE "tenant_members" ADD COLUMN "suspension_reason" text;--> statement-breakpoint
ALTER TABLE "tenant_members" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenant_members" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "tenant_members" ADD COLUMN "deletion_reason" text;--> statement-breakpoint
ALTER TABLE "tenant_members" ADD COLUMN "retention_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenant_members" ADD CONSTRAINT "tenant_members_suspended_by_users_id_fk" FOREIGN KEY ("suspended_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_members" ADD CONSTRAINT "tenant_members_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
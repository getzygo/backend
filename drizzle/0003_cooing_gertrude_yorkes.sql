CREATE TABLE "tenant_archives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tenant_name" varchar(100) NOT NULL,
	"tenant_slug" varchar(50) NOT NULL,
	"archive_path" text NOT NULL,
	"archive_size_bytes" integer,
	"encryption_key_id" varchar(100),
	"checksum_sha256" varchar(64),
	"archived_data" jsonb DEFAULT '{}'::jsonb,
	"deleted_by" uuid,
	"deletion_reason" text,
	"legal_hold" boolean DEFAULT false,
	"legal_hold_reason" text,
	"legal_hold_by" uuid,
	"legal_hold_at" timestamp with time zone,
	"legal_hold_until" timestamp with time zone,
	"archived_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retention_expires_at" timestamp with time zone NOT NULL,
	"purged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" varchar(30) NOT NULL,
	"name" varchar(100) NOT NULL,
	"email" varchar(255) NOT NULL,
	"phone" varchar(30),
	"phone_country_code" varchar(5),
	"email_verified" boolean DEFAULT false,
	"email_verified_at" timestamp with time zone,
	"phone_verified" boolean DEFAULT false,
	"phone_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"alert_type" varchar(20) NOT NULL,
	"ip_address" varchar(45),
	"device_info" jsonb DEFAULT '{}'::jsonb,
	"location" jsonb DEFAULT '{}'::jsonb,
	"email_sent_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"is_suspicious" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "magic_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"token_hash" text NOT NULL,
	"redirect_url" text,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "magic_links_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "passkeys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" text NOT NULL,
	"counter" integer DEFAULT 0 NOT NULL,
	"transports" text[],
	"device_type" varchar(50),
	"name" varchar(100),
	"aaguid" text,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "passkeys_credential_id_unique" UNIQUE("credential_id")
);
--> statement-breakpoint
CREATE TABLE "trusted_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"device_hash" text NOT NULL,
	"device_name" varchar(100),
	"browser" varchar(50),
	"os" varchar(50),
	"ip_address" varchar(45),
	"trusted_until" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tenant_id" uuid,
	"token_hash" text NOT NULL,
	"device_name" varchar(100),
	"browser" varchar(50),
	"os" varchar(50),
	"ip_address" varchar(45),
	"location_city" varchar(100),
	"location_country" varchar(100),
	"is_current" boolean DEFAULT false NOT NULL,
	"last_active_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "webauthn_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"challenge" text NOT NULL,
	"type" varchar(20) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email_enabled" boolean DEFAULT true NOT NULL,
	"in_app_enabled" boolean DEFAULT true NOT NULL,
	"sound_enabled" boolean DEFAULT true NOT NULL,
	"sound_volume" integer DEFAULT 50 NOT NULL,
	"dnd_enabled" boolean DEFAULT false NOT NULL,
	"dnd_start_time" time,
	"dnd_end_time" time,
	"category_preferences" jsonb DEFAULT '{}'::jsonb,
	"paused_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" varchar(50) NOT NULL,
	"category" varchar(50) NOT NULL,
	"title" varchar(255) NOT NULL,
	"message" text,
	"action_route" varchar(255),
	"action_label" varchar(100),
	"severity" varchar(20) DEFAULT 'info' NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"read_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT NOW() + INTERVAL '90 days' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reminder_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"tenant_id" uuid,
	"reminder_type" varchar(50) NOT NULL,
	"stage" varchar(20) NOT NULL,
	"email_sent" boolean DEFAULT false NOT NULL,
	"email_sent_at" timestamp with time zone,
	"email_error" text,
	"in_app_sent" boolean DEFAULT false NOT NULL,
	"in_app_sent_at" timestamp with time zone,
	"deadline_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_alert_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"alert_type" varchar(50) NOT NULL,
	"fingerprint" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT NOW() + INTERVAL '24 hours' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "title" varchar(20);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "job_title" varchar(100);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "reporting_manager_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_source" varchar(10);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "state" varchar(100);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "state_code" varchar(10);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "address_line_1" varchar(255);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "address_line_2" varchar(255);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "postal_code" varchar(20);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_breached_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "login_notification_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "webauthn_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "preferred_auth_method" varchar(20) DEFAULT 'password';--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "website" varchar(255);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "phone" varchar(30);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "phone_country_code" varchar(5);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "address_line1" varchar(255);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "address_line2" varchar(255);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "city" varchar(100);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "state_province" varchar(100);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "state_code" varchar(10);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "postal_code" varchar(20);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "country" varchar(2);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "business_type" varchar(30);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "incorporation_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "country_of_incorporation" varchar(2);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "registration_number" varchar(50);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "vat_number" varchar(30);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "vat_verified" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "tax_id_verified" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "use_different_billing_address" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "billing_address_line2" varchar(255);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "billing_phone" varchar(30);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "billing_phone_country_code" varchar(5);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "billing_email_verified" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "billing_email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "billing_phone_verified" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "billing_phone_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "phone_verified" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "phone_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "deletion_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "deletion_scheduled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "deletion_cancelable_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "deletion_reason" text;--> statement-breakpoint
ALTER TABLE "tenant_members" ADD COLUMN "job_title" varchar(100);--> statement-breakpoint
ALTER TABLE "tenant_members" ADD COLUMN "reporting_manager_id" uuid;--> statement-breakpoint
ALTER TABLE "tenant_contacts" ADD CONSTRAINT "tenant_contacts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "login_alerts" ADD CONSTRAINT "login_alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkeys" ADD CONSTRAINT "passkeys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trusted_devices" ADD CONSTRAINT "trusted_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webauthn_challenges" ADD CONSTRAINT "webauthn_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_logs" ADD CONSTRAINT "reminder_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_logs" ADD CONSTRAINT "reminder_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_alert_log" ADD CONSTRAINT "security_alert_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_tenant_archives_tenant" ON "tenant_archives" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_tenant_archives_retention" ON "tenant_archives" USING btree ("retention_expires_at");--> statement-breakpoint
CREATE INDEX "idx_tenant_archives_legal_hold" ON "tenant_archives" USING btree ("legal_hold");--> statement-breakpoint
CREATE INDEX "idx_tenant_contacts_tenant" ON "tenant_contacts" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_tenant_contacts_tenant_type" ON "tenant_contacts" USING btree ("tenant_id","type");--> statement-breakpoint
CREATE INDEX "idx_login_alerts_user" ON "login_alerts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_login_alerts_type" ON "login_alerts" USING btree ("alert_type");--> statement-breakpoint
CREATE INDEX "idx_login_alerts_created" ON "login_alerts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_magic_links_email" ON "magic_links" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_magic_links_token" ON "magic_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_magic_links_expires" ON "magic_links" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_passkeys_user" ON "passkeys" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_passkeys_credential" ON "passkeys" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "idx_trusted_devices_user" ON "trusted_devices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_trusted_devices_hash" ON "trusted_devices" USING btree ("device_hash");--> statement-breakpoint
CREATE INDEX "idx_trusted_devices_expires" ON "trusted_devices" USING btree ("trusted_until");--> statement-breakpoint
CREATE INDEX "idx_user_sessions_user" ON "user_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_user_sessions_tenant" ON "user_sessions" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_user_sessions_token" ON "user_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_user_sessions_expires" ON "user_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_webauthn_challenges_user" ON "webauthn_challenges" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_webauthn_challenges_expires" ON "webauthn_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_notification_preferences_user_tenant" ON "notification_preferences" USING btree ("user_id","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_notifications_user_tenant" ON "notifications" USING btree ("user_id","tenant_id");--> statement-breakpoint
CREATE INDEX "idx_notifications_unread" ON "notifications" USING btree ("user_id","tenant_id","is_read");--> statement-breakpoint
CREATE INDEX "idx_notifications_expires" ON "notifications" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_notifications_created" ON "notifications" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_reminder_logs_unique" ON "reminder_logs" USING btree ("user_id","tenant_id","reminder_type","stage");--> statement-breakpoint
CREATE INDEX "idx_reminder_logs_user" ON "reminder_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_reminder_logs_tenant" ON "reminder_logs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_security_alert_dedup" ON "security_alert_log" USING btree ("user_id","alert_type","fingerprint");--> statement-breakpoint
CREATE INDEX "idx_security_alert_expires" ON "security_alert_log" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_reporting_manager_id_users_id_fk" FOREIGN KEY ("reporting_manager_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_members" ADD CONSTRAINT "tenant_members_reporting_manager_id_users_id_fk" FOREIGN KEY ("reporting_manager_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_audit_logs_tenant" ON "audit_logs" USING btree ("tenant_id");
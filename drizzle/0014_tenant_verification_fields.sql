-- Migration: Add verification fields to tenants and tenant_contacts
-- Part of email & phone verification for Tenant Settings feature

-- Add verification fields to tenants
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS billing_email_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS billing_email_verified_at TIMESTAMPTZ;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS billing_phone_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS billing_phone_verified_at TIMESTAMPTZ;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ;

-- Add verification fields to tenant_contacts
ALTER TABLE tenant_contacts ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE tenant_contacts ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
ALTER TABLE tenant_contacts ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE tenant_contacts ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ;

-- Grandfather existing data as verified
-- Tenants with existing billing email
UPDATE tenants SET billing_email_verified = TRUE, billing_email_verified_at = NOW()
WHERE billing_email IS NOT NULL AND billing_email != '';

-- Tenants with existing billing phone
UPDATE tenants SET billing_phone_verified = TRUE, billing_phone_verified_at = NOW()
WHERE billing_phone IS NOT NULL AND billing_phone != '';

-- Tenants with existing company phone
UPDATE tenants SET phone_verified = TRUE, phone_verified_at = NOW()
WHERE phone IS NOT NULL AND phone != '';

-- Contacts with existing email
UPDATE tenant_contacts SET email_verified = TRUE, email_verified_at = NOW()
WHERE email IS NOT NULL AND email != '';

-- Contacts with existing phone
UPDATE tenant_contacts SET phone_verified = TRUE, phone_verified_at = NOW()
WHERE phone IS NOT NULL AND phone != '';

-- Migration: 0011_add_company_settings.sql
-- Description: Add company settings fields to tenants table and create tenant_contacts table
-- Used for: Company Settings page (General, Legal, Billing tabs)

-- ============================================================================
-- Add Company Address Fields to Tenants (General Tab)
-- ============================================================================

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS website VARCHAR(255);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS phone VARCHAR(30);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS phone_country_code VARCHAR(5);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS address_line1 VARCHAR(255);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS address_line2 VARCHAR(255);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS city VARCHAR(100);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS state_province VARCHAR(100);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS postal_code VARCHAR(20);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS country VARCHAR(2);

-- ============================================================================
-- Add Legal & Tax Fields to Tenants (Legal Tab)
-- ============================================================================

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS business_type VARCHAR(30);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS incorporation_date TIMESTAMPTZ;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS country_of_incorporation VARCHAR(2);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS registration_number VARCHAR(50);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS vat_number VARCHAR(30);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS vat_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS tax_id_verified BOOLEAN DEFAULT FALSE;

-- ============================================================================
-- Add Additional Billing Address Fields to Tenants (Billing Tab)
-- ============================================================================

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS use_different_billing_address BOOLEAN DEFAULT FALSE;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS billing_address_line2 VARCHAR(255);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS billing_phone VARCHAR(30);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS billing_phone_country_code VARCHAR(5);

-- ============================================================================
-- Tenant Contacts Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS tenant_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Contact type: 'primary' | 'technical-support' | 'financial' | 'marketing' | 'sales' | 'legal' | 'hr' | 'operations' | 'customer-success'
  type VARCHAR(30) NOT NULL,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(30),
  phone_country_code VARCHAR(5),

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for querying contacts by tenant
CREATE INDEX IF NOT EXISTS idx_tenant_contacts_tenant ON tenant_contacts(tenant_id);

-- Unique constraint: one contact per type per tenant
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_contacts_tenant_type ON tenant_contacts(tenant_id, type);

-- ============================================================================
-- Row Level Security (RLS)
-- ============================================================================

-- Enable RLS
ALTER TABLE tenant_contacts ENABLE ROW LEVEL SECURITY;

-- Tenant contacts: tenant members can view
CREATE POLICY tenant_contacts_tenant_read ON tenant_contacts
  FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_members
      WHERE user_id = auth.uid() AND status = 'active'
    )
  );

-- Tenant contacts: admins can manage (insert/update/delete)
-- This will be enforced via application-level permission checks
CREATE POLICY tenant_contacts_tenant_write ON tenant_contacts
  FOR ALL
  USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_members
      WHERE user_id = auth.uid() AND status = 'active'
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM tenant_members
      WHERE user_id = auth.uid() AND status = 'active'
    )
  );

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE tenant_contacts IS 'Contact information for different roles within a tenant organization';
COMMENT ON COLUMN tenant_contacts.type IS 'Contact role: primary, technical-support, financial, marketing, sales, legal, hr, operations, customer-success';
COMMENT ON COLUMN tenant_contacts.name IS 'Full name of the contact person';
COMMENT ON COLUMN tenant_contacts.email IS 'Email address for this contact';
COMMENT ON COLUMN tenant_contacts.phone IS 'Phone number without country code';
COMMENT ON COLUMN tenant_contacts.phone_country_code IS 'ISO country code for phone (e.g., +1, +44)';

COMMENT ON COLUMN tenants.website IS 'Company website URL';
COMMENT ON COLUMN tenants.phone IS 'Main company phone number';
COMMENT ON COLUMN tenants.address_line1 IS 'Primary address line';
COMMENT ON COLUMN tenants.country IS 'ISO 3166-1 alpha-2 country code';
COMMENT ON COLUMN tenants.business_type IS 'Legal business structure type';
COMMENT ON COLUMN tenants.incorporation_date IS 'Date the business was incorporated';
COMMENT ON COLUMN tenants.registration_number IS 'Business registration/incorporation number';
COMMENT ON COLUMN tenants.vat_number IS 'VAT/GST registration number';
COMMENT ON COLUMN tenants.vat_verified IS 'Whether VAT number has been verified';
COMMENT ON COLUMN tenants.tax_id_verified IS 'Whether Tax ID has been verified';

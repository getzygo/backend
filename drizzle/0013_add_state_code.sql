-- Migration: 0013_add_state_code.sql
-- Description: Add state_code column to tenants table for cascading State/City selects

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS state_code VARCHAR(10);

COMMENT ON COLUMN tenants.state_code IS 'State/Province code (e.g., CA, NY, NSW)';

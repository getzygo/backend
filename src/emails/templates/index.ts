/**
 * Email Templates Index
 *
 * Export all email templates.
 */

// User security notifications
export { EmailVerification } from './email-verification';
export { PasswordReset } from './password-reset';
export { PasswordChanged } from './password-changed';
export { Welcome } from './welcome';
export { LoginAlert } from './login-alert';
export { MfaEnabled } from './mfa-enabled';
export { MfaDisabled } from './mfa-disabled';
export { SessionRevoked } from './session-revoked';
export { BackupCodesRegenerated } from './backup-codes-regenerated';

// Tenant/workspace notifications
export { BillingEmailChanged } from './billing-email-changed';
export { PrimaryContactChanged } from './primary-contact-changed';
export { TenantDeletionRequested } from './tenant-deletion-requested';
export { TenantDeletionCancelled } from './tenant-deletion-cancelled';

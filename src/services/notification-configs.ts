/**
 * Notification Configurations
 *
 * Pre-defined notification configurations for consistency across all notification types.
 * Used by the notification hub to ensure consistent messaging.
 */

import {
  MfaEnabled,
  MfaDisabled,
  SessionRevoked,
  PasswordChanged,
  BackupCodesRegenerated,
  LoginAlert,
  Welcome,
  BillingEmailChanged,
  PrimaryContactChanged,
  TenantDeletionRequested,
  TenantDeletionCancelled,
} from '../emails/templates';
import { TeamInvite } from '../emails/templates/team-invite';
import type { NotificationType, NotificationSeverity, NotificationCategory } from './notification.service';

interface NotificationConfig {
  type: NotificationType;
  category: NotificationCategory;
  title: string;
  message: string | ((details?: Record<string, unknown>) => string);
  severity: NotificationSeverity;
  actionRoute: string;
  actionLabel: string;
  emailSubject: string;
}

export const NOTIFICATION_CONFIGS: Record<string, NotificationConfig> = {
  mfa_enabled: {
    type: 'security',
    category: 'mfa_enabled',
    title: 'Two-Factor Authentication Enabled',
    message: 'You have successfully enabled two-factor authentication on your account.',
    severity: 'success',
    actionRoute: '/settings/security',
    actionLabel: 'View Security Settings',
    emailSubject: 'Two-factor authentication enabled - Zygo',
  },

  mfa_disabled: {
    type: 'security',
    category: 'mfa_disabled',
    title: 'Two-Factor Authentication Disabled',
    message: 'Two-factor authentication has been disabled on your account. If you did not do this, please secure your account immediately.',
    severity: 'warning',
    actionRoute: '/settings/security',
    actionLabel: 'Re-enable 2FA',
    emailSubject: 'Two-factor authentication disabled - Zygo',
  },

  session_revoked: {
    type: 'security',
    category: 'session_revoked',
    title: 'Session Logged Out',
    message: (details) => {
      const device = details?.device as string | undefined;
      return device
        ? `A session on ${device} has been logged out.`
        : 'One of your sessions has been logged out.';
    },
    severity: 'info',
    actionRoute: '/settings/sessions',
    actionLabel: 'View Sessions',
    emailSubject: 'A session has been logged out - Zygo',
  },

  password_changed: {
    type: 'security',
    category: 'password_changed',
    title: 'Password Changed',
    message: 'Your password has been changed successfully. If you did not do this, please contact support immediately.',
    severity: 'warning',
    actionRoute: '/settings/security',
    actionLabel: 'Review Security',
    emailSubject: 'Your password has been changed - Zygo',
  },

  backup_codes: {
    type: 'security',
    category: 'backup_codes',
    title: 'Backup Codes Regenerated',
    message: 'Your backup codes have been regenerated. Your old codes are no longer valid.',
    severity: 'info',
    actionRoute: '/settings/security',
    actionLabel: 'View Backup Codes',
    emailSubject: 'Backup codes regenerated - Zygo',
  },

  login_alert: {
    type: 'security',
    category: 'login_alert',
    title: 'New Sign-in Detected',
    message: (details) => {
      const parts: string[] = [];
      if (details?.device) parts.push(`from ${details.device}`);
      if (details?.location) parts.push(`in ${details.location}`);
      return parts.length > 0
        ? `New sign-in to your account ${parts.join(' ')}.`
        : 'New sign-in to your account detected.';
    },
    severity: 'info',
    actionRoute: '/settings/sessions',
    actionLabel: 'Review Sessions',
    emailSubject: 'New sign-in to your account - Zygo',
  },

  suspicious_login: {
    type: 'security',
    category: 'suspicious_login',
    title: 'Suspicious Sign-in Detected',
    message: 'A suspicious sign-in attempt was detected on your account. Please review your recent activity.',
    severity: 'danger',
    actionRoute: '/settings/sessions',
    actionLabel: 'Review Sessions',
    emailSubject: 'Suspicious sign-in detected - Zygo',
  },

  welcome: {
    type: 'system',
    category: 'welcome',
    title: 'Welcome to Zygo!',
    message: 'Your email has been verified. You now have full access to all features.',
    severity: 'success',
    actionRoute: '/dashboard',
    actionLabel: 'Go to Dashboard',
    emailSubject: 'Welcome to Zygo!',
  },

  // Tenant/workspace notifications
  billing_email_changed: {
    type: 'system',
    category: 'billing_email_changed',
    title: 'Billing Email Changed',
    message: (details) => {
      const isNew = details?.isNewAddress as boolean | undefined;
      return isNew
        ? 'You have been set as the billing contact for this workspace.'
        : 'The billing email for this workspace has been changed.';
    },
    severity: 'warning',
    actionRoute: '/settings/billing',
    actionLabel: 'View Billing Settings',
    emailSubject: 'Billing email changed - Zygo',
  },

  primary_contact_added: {
    type: 'system',
    category: 'primary_contact_changed',
    title: 'Primary Contact Added',
    message: 'You have been set as the primary contact for this workspace.',
    severity: 'info',
    actionRoute: '/settings/contacts',
    actionLabel: 'View Contact Settings',
    emailSubject: 'You are now the primary contact - Zygo',
  },

  primary_contact_updated: {
    type: 'system',
    category: 'primary_contact_changed',
    title: 'Primary Contact Updated',
    message: 'The primary contact information for this workspace has been updated.',
    severity: 'info',
    actionRoute: '/settings/contacts',
    actionLabel: 'View Contact Settings',
    emailSubject: 'Primary contact updated - Zygo',
  },

  primary_contact_removed: {
    type: 'system',
    category: 'primary_contact_changed',
    title: 'Primary Contact Removed',
    message: 'You have been removed as the primary contact for this workspace.',
    severity: 'warning',
    actionRoute: '/settings/contacts',
    actionLabel: 'View Contact Settings',
    emailSubject: 'Primary contact removed - Zygo',
  },

  tenant_deletion_requested: {
    type: 'system',
    category: 'tenant_deletion_requested',
    title: 'Workspace Deletion Requested',
    message: (details) => {
      const tenantName = details?.tenantName as string | undefined;
      return tenantName
        ? `The workspace "${tenantName}" has been scheduled for permanent deletion.`
        : 'Your workspace has been scheduled for permanent deletion.';
    },
    severity: 'danger',
    actionRoute: '/settings/danger-zone',
    actionLabel: 'View Deletion Status',
    emailSubject: 'Workspace deletion scheduled - Zygo',
  },

  tenant_deletion_cancelled: {
    type: 'system',
    category: 'tenant_deletion_cancelled',
    title: 'Workspace Deletion Cancelled',
    message: (details) => {
      const tenantName = details?.tenantName as string | undefined;
      return tenantName
        ? `Good news! The deletion of "${tenantName}" has been cancelled.`
        : 'Good news! The workspace deletion has been cancelled.';
    },
    severity: 'success',
    actionRoute: '/dashboard',
    actionLabel: 'Go to Dashboard',
    emailSubject: 'Workspace deletion cancelled - Zygo',
  },

  team_invitation_received: {
    type: 'team',
    category: 'team_invitation',
    title: 'Workspace Invitation',
    message: (details) => {
      const inviter = details?.inviterName as string | undefined;
      const tenant = details?.tenantName as string | undefined;
      return inviter && tenant
        ? `${inviter} invited you to join ${tenant}.`
        : 'You have been invited to join a workspace.';
    },
    severity: 'success',
    actionRoute: '/invites',
    actionLabel: 'View Invitation',
    emailSubject: "You've been invited to join a workspace - Zygo",
  },

  member_joined: {
    type: 'team',
    category: 'member_joined',
    title: 'New Team Member',
    message: (details) => {
      const memberName = details?.memberName as string | undefined;
      const tenantName = details?.tenantName as string | undefined;
      return memberName
        ? `${memberName} has joined ${tenantName || 'the workspace'}.`
        : 'A new member has joined the workspace.';
    },
    severity: 'success',
    actionRoute: '/settings/users',
    actionLabel: 'View Members',
    emailSubject: 'A new member has joined your workspace - Zygo',
  },
};

/**
 * Get a notification config with resolved message
 */
export function getNotificationConfig(
  key: keyof typeof NOTIFICATION_CONFIGS,
  details?: Record<string, unknown>
): NotificationConfig & { message: string } {
  const config = NOTIFICATION_CONFIGS[key];
  if (!config) {
    throw new Error(`Unknown notification config: ${key}`);
  }

  const message = typeof config.message === 'function'
    ? config.message(details)
    : config.message;

  return {
    ...config,
    message,
  };
}

// Email template factory functions for convenience
export const EMAIL_TEMPLATES = {
  mfaEnabled: (props: { firstName?: string; method?: 'totp' | 'webauthn' | 'sms'; appUrl?: string }) =>
    MfaEnabled({
      firstName: props.firstName || 'there',
      method: props.method || 'totp',
      enabledAt: new Date(),
      appUrl: props.appUrl,
    }),

  mfaDisabled: (props: { firstName?: string; ipAddress?: string; deviceInfo?: string; appUrl?: string }) =>
    MfaDisabled({
      firstName: props.firstName || 'there',
      disabledAt: new Date(),
      ipAddress: props.ipAddress,
      deviceInfo: props.deviceInfo,
      appUrl: props.appUrl,
    }),

  sessionRevoked: (props: {
    firstName?: string;
    revokedDevice?: string;
    revokedBrowser?: string;
    revokedLocation?: string;
    revokedBy?: 'user' | 'admin' | 'system';
    revokerDevice?: string;
    appUrl?: string;
  }) =>
    SessionRevoked({
      firstName: props.firstName || 'there',
      revokedDevice: props.revokedDevice,
      revokedBrowser: props.revokedBrowser,
      revokedLocation: props.revokedLocation,
      revokedAt: new Date(),
      revokedBy: props.revokedBy || 'user',
      revokerDevice: props.revokerDevice,
      appUrl: props.appUrl,
    }),

  passwordChanged: (props: { firstName?: string; ipAddress?: string; deviceInfo?: string; appUrl?: string }) =>
    PasswordChanged({
      firstName: props.firstName || 'there',
      changedAt: new Date(),
      ipAddress: props.ipAddress,
      deviceInfo: props.deviceInfo,
      appUrl: props.appUrl,
    }),

  backupCodesRegenerated: (props: { firstName?: string; ipAddress?: string; deviceInfo?: string; appUrl?: string }) =>
    BackupCodesRegenerated({
      firstName: props.firstName || 'there',
      regeneratedAt: new Date(),
      ipAddress: props.ipAddress,
      deviceInfo: props.deviceInfo,
      appUrl: props.appUrl,
    }),

  loginAlert: (props: {
    firstName?: string;
    alerts: string[];
    device?: string;
    browser?: string;
    os?: string;
    location?: string;
    ipAddress?: string;
    isSuspicious?: boolean;
    appUrl?: string;
  }) =>
    LoginAlert({
      firstName: props.firstName || 'there',
      alerts: props.alerts,
      device: props.device,
      browser: props.browser,
      os: props.os,
      location: props.location,
      ipAddress: props.ipAddress,
      timestamp: new Date(),
      isSuspicious: props.isSuspicious,
      appUrl: props.appUrl,
    }),

  welcome: (props: { firstName?: string; appUrl?: string }) =>
    Welcome({
      firstName: props.firstName || 'there',
      appUrl: props.appUrl,
    }),

  // Tenant/workspace email templates
  billingEmailChanged: (props: {
    tenantName?: string;
    newEmail?: string;
    changedBy?: string;
    isNewAddress?: boolean;
    appUrl?: string;
  }) =>
    BillingEmailChanged({
      tenantName: props.tenantName,
      newEmail: props.newEmail,
      changedBy: props.changedBy,
      changedAt: new Date(),
      isNewAddress: props.isNewAddress,
      appUrl: props.appUrl,
    }),

  primaryContactChanged: (props: {
    contactName?: string;
    action?: 'added' | 'updated' | 'removed';
    changedBy?: string;
    newEmail?: string;
    isNewAddress?: boolean;
    appUrl?: string;
  }) =>
    PrimaryContactChanged({
      contactName: props.contactName,
      action: props.action,
      changedBy: props.changedBy,
      changedAt: new Date(),
      newEmail: props.newEmail,
      isNewAddress: props.isNewAddress,
      appUrl: props.appUrl,
    }),

  tenantDeletionRequested: (props: {
    firstName?: string;
    tenantName?: string;
    deletionScheduledAt: Date;
    cancelableUntil: Date;
    requestedBy?: string;
    reason?: string;
    appUrl?: string;
  }) =>
    TenantDeletionRequested({
      firstName: props.firstName,
      tenantName: props.tenantName,
      deletionScheduledAt: props.deletionScheduledAt,
      cancelableUntil: props.cancelableUntil,
      requestedBy: props.requestedBy,
      reason: props.reason,
      appUrl: props.appUrl,
    }),

  tenantDeletionCancelled: (props: {
    firstName?: string;
    tenantName?: string;
    cancelledBy?: string;
    appUrl?: string;
  }) =>
    TenantDeletionCancelled({
      firstName: props.firstName,
      tenantName: props.tenantName,
      cancelledBy: props.cancelledBy,
      cancelledAt: new Date(),
      appUrl: props.appUrl,
    }),

  teamInvite: (props: {
    inviteeName?: string;
    inviterName?: string;
    tenantName?: string;
    roleName?: string;
    message?: string;
    acceptUrl: string;
    expiresInDays?: number;
  }) =>
    TeamInvite(props),
};

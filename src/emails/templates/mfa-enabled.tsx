/**
 * MFA Enabled Template
 *
 * Sent when a user enables two-factor authentication.
 * ALLOW_DISABLE policy - user can disable these alerts.
 *
 * Uses only standard @react-email/components (no custom components)
 * for reliable rendering across all email clients.
 */

import {
  Html,
  Head,
  Preview,
  Body,
  Container,
  Section,
  Text,
  Link,
  Img,
  Hr,
  Row,
  Column,
  Button,
} from '@react-email/components';

interface MfaEnabledProps {
  firstName?: string;
  method?: 'totp' | 'webauthn' | 'sms';
  enabledAt?: Date;
  appUrl?: string;
}

export function MfaEnabled({
  firstName = 'there',
  method = 'totp',
  enabledAt = new Date(),
  appUrl = 'https://app.getzygo.com',
}: MfaEnabledProps) {
  const formattedDate = enabledAt.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  const methodLabels = {
    totp: 'Authenticator App',
    webauthn: 'Security Key',
    sms: 'SMS',
  };

  const year = new Date().getFullYear();

  return (
    <Html>
      <Head />
      <Preview>Two-factor authentication has been enabled on your Zygo account</Preview>
      <Body style={{ backgroundColor: '#f9fafb', fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif', margin: 0, padding: 0 }}>
        <Container style={{ backgroundColor: '#ffffff', maxWidth: '600px', margin: '40px auto', padding: '0 24px 24px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>

          {/* Header with logo */}
          <Section style={{ padding: '24px 0', borderBottom: '1px solid #e5e7eb', marginBottom: '32px' }}>
            <Row>
              <Column align="center">
                <Img
                  src="https://demo.zygo.tech/logo.png"
                  alt="Zygo"
                  width="48"
                  height="48"
                  style={{ display: 'block', margin: '0 auto' }}
                />
              </Column>
            </Row>
          </Section>

          {/* Content */}
          <Section style={{ padding: '0 24px' }}>
            <Text style={{ fontSize: '24px', fontWeight: 600, color: '#111827', margin: '0 0 24px 0', textAlign: 'center' as const }}>
              Two-factor authentication enabled
            </Text>

            <Text style={{ fontSize: '15px', lineHeight: '1.6', color: '#374151', margin: '0 0 16px 0' }}>
              Hi {firstName},
            </Text>

            <Text style={{ fontSize: '15px', lineHeight: '1.6', color: '#374151', margin: '0 0 16px 0' }}>
              Great news! Two-factor authentication (2FA) has been successfully
              enabled on your Zygo account using {methodLabels[method]}.
            </Text>

            {/* Success alert box */}
            <Section style={{ padding: '16px 20px', borderLeft: '4px solid #22c55e', borderRadius: '4px', margin: '24px 0', backgroundColor: '#f0fdf4' }}>
              <Text style={{ fontSize: '14px', fontWeight: 600, margin: '0 0 8px 0', color: '#166534' }}>
                Your account is now more secure
              </Text>
              <Text style={{ fontSize: '14px', margin: '0', lineHeight: '1.5', color: '#166534' }}>
                Two-factor authentication adds an extra layer of security to your
                account. You'll need to provide a verification code in addition to
                your password when signing in.
              </Text>
            </Section>

            {/* Details box */}
            <Section style={{ backgroundColor: '#f9fafb', borderRadius: '8px', padding: '16px 20px', margin: '24px 0' }}>
              <Text style={{ fontSize: '12px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' as const, margin: '0 0 4px 0' }}>
                Method
              </Text>
              <Text style={{ fontSize: '14px', color: '#111827', margin: '0 0 12px 0' }}>
                {methodLabels[method]}
              </Text>

              <Text style={{ fontSize: '12px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' as const, margin: '0 0 4px 0' }}>
                Enabled On
              </Text>
              <Text style={{ fontSize: '14px', color: '#111827', margin: '0' }}>
                {formattedDate}
              </Text>
            </Section>

            <Text style={{ fontSize: '16px', fontWeight: 600, color: '#111827', margin: '24px 0 12px 0' }}>
              Important reminders
            </Text>

            <Section style={{ margin: '0 0 24px 0' }}>
              <Text style={{ fontSize: '14px', lineHeight: '1.6', color: '#374151', margin: '0 0 12px 0' }}>
                <strong>Save your backup codes</strong> - If you lose access to
                your authentication method, backup codes will help you regain
                access to your account.
              </Text>
              <Text style={{ fontSize: '14px', lineHeight: '1.6', color: '#374151', margin: '0 0 12px 0' }}>
                <strong>Keep your authenticator app safe</strong> - Don't
                uninstall or reset your authenticator app without first
                disabling 2FA or saving your backup codes.
              </Text>
            </Section>

            {/* CTA Button */}
            <Section style={{ textAlign: 'center' as const, margin: '24px 0' }}>
              <Button
                href={`${appUrl}/settings/security`}
                style={{
                  display: 'inline-block',
                  padding: '12px 24px',
                  fontSize: '14px',
                  fontWeight: 600,
                  textDecoration: 'none',
                  textAlign: 'center' as const,
                  borderRadius: '6px',
                  lineHeight: '1.5',
                  backgroundColor: '#4f46e5',
                  color: '#ffffff',
                }}
              >
                View Security Settings
              </Button>
            </Section>

            <Text style={{ fontSize: '14px', color: '#6b7280', textAlign: 'center' as const, margin: '0 0 24px 0' }}>
              Need help?{' '}
              <Link href="mailto:support@getzygo.com" style={{ color: '#4f46e5', textDecoration: 'none' }}>
                Contact support
              </Link>
            </Text>

            <Text style={{ fontSize: '15px', lineHeight: '1.6', color: '#374151', margin: '24px 0 0 0' }}>
              Stay secure,
              <br />
              The Zygo Security Team
            </Text>
          </Section>

          {/* Footer */}
          <Section style={{ marginTop: '32px', textAlign: 'center' as const }}>
            <Hr style={{ borderColor: '#e5e7eb', margin: '24px 0' }} />

            <Text style={{ fontSize: '13px', color: '#6b7280', margin: '0 0 16px 0' }}>
              <Link href="https://getzygo.com/privacy" style={{ color: '#4f46e5', textDecoration: 'none' }}>
                Privacy Policy
              </Link>
              {' • '}
              <Link href="https://getzygo.com/terms" style={{ color: '#4f46e5', textDecoration: 'none' }}>
                Terms of Service
              </Link>
              {' • '}
              <Link href="mailto:support@getzygo.com" style={{ color: '#4f46e5', textDecoration: 'none' }}>
                Contact Support
              </Link>
            </Text>

            <Text style={{ fontSize: '12px', color: '#9ca3af', margin: '0 0 16px 0' }}>
              <Link href={`${appUrl}/settings/notifications`} style={{ color: '#4f46e5', textDecoration: 'none' }}>
                Unsubscribe from these emails
              </Link>
            </Text>

            <Text style={{ fontSize: '12px', color: '#9ca3af', lineHeight: '1.5', margin: '0 0 8px 0' }}>
              ZYGO AI Technologies
              <br />
              Budapest, Hungary
            </Text>

            <Text style={{ fontSize: '12px', color: '#9ca3af', margin: '0' }}>
              © {year} Zygo. All rights reserved.
            </Text>
          </Section>

        </Container>
      </Body>
    </Html>
  );
}

export default MfaEnabled;

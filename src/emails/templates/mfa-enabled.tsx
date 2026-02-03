/**
 * MFA Enabled Template
 *
 * Sent when a user enables two-factor authentication.
 * ALLOW_DISABLE policy - user can disable these alerts.
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
} from '@react-email/components';
import { Header, Footer, Button, AlertBox } from '../components';

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

  return (
    <Html>
      <Head />
      <Preview>Two-factor authentication has been enabled on your Zygo account</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Header />

          <Section style={contentStyle}>
            <Text style={headingStyle}>Two-factor authentication enabled</Text>

            <Text style={paragraphStyle}>Hi {firstName},</Text>

            <Text style={paragraphStyle}>
              Great news! Two-factor authentication (2FA) has been successfully
              enabled on your Zygo account using {methodLabels[method]}.
            </Text>

            <AlertBox variant="success" title="Your account is now more secure">
              Two-factor authentication adds an extra layer of security to your
              account. You&apos;ll need to provide a verification code in addition to
              your password when signing in.
            </AlertBox>

            <Section style={detailsContainerStyle}>
              <Text style={detailsLabelStyle}>Method</Text>
              <Text style={detailsValueStyle}>{methodLabels[method]}</Text>

              <Text style={detailsLabelStyle}>Enabled On</Text>
              <Text style={detailsValueStyle}>{formattedDate}</Text>
            </Section>

            <Text style={subheadingStyle}>Important reminders</Text>

            <Section style={listContainerStyle}>
              <Text style={listItemStyle}>
                <strong>Save your backup codes</strong> - If you lose access to
                your authentication method, backup codes will help you regain
                access to your account.
              </Text>
              <Text style={listItemStyle}>
                <strong>Keep your authenticator app safe</strong> - Don&apos;t
                uninstall or reset your authenticator app without first
                disabling 2FA or saving your backup codes.
              </Text>
            </Section>

            <Section style={buttonContainerStyle}>
              <Button href={`${appUrl}/settings/security`}>
                View Security Settings
              </Button>
            </Section>

            <Text style={helpTextStyle}>
              Need help?{' '}
              <Link href="mailto:support@getzygo.com" style={linkStyle}>
                Contact support
              </Link>
            </Text>

            <Text style={signatureStyle}>
              Stay secure,
              <br />
              The Zygo Security Team
            </Text>
          </Section>

          <Footer includeUnsubscribe={true} unsubscribeUrl={`${appUrl}/settings/notifications`} />
        </Container>
      </Body>
    </Html>
  );
}

const bodyStyle: React.CSSProperties = {
  backgroundColor: '#f9fafb',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  margin: 0,
  padding: 0,
};

const containerStyle: React.CSSProperties = {
  backgroundColor: '#ffffff',
  maxWidth: '600px',
  margin: '40px auto',
  padding: '0 24px 24px',
  borderRadius: '8px',
  boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
};

const contentStyle: React.CSSProperties = {
  padding: '0 24px',
};

const headingStyle: React.CSSProperties = {
  fontSize: '24px',
  fontWeight: 600,
  color: '#111827',
  margin: '0 0 24px 0',
  textAlign: 'center' as const,
};

const subheadingStyle: React.CSSProperties = {
  fontSize: '16px',
  fontWeight: 600,
  color: '#111827',
  margin: '24px 0 12px 0',
};

const paragraphStyle: React.CSSProperties = {
  fontSize: '15px',
  lineHeight: '1.6',
  color: '#374151',
  margin: '0 0 16px 0',
};

const detailsContainerStyle: React.CSSProperties = {
  backgroundColor: '#f9fafb',
  borderRadius: '8px',
  padding: '16px 20px',
  margin: '24px 0',
};

const detailsLabelStyle: React.CSSProperties = {
  fontSize: '12px',
  fontWeight: 600,
  color: '#6b7280',
  textTransform: 'uppercase' as const,
  margin: '0 0 4px 0',
};

const detailsValueStyle: React.CSSProperties = {
  fontSize: '14px',
  color: '#111827',
  margin: '0 0 12px 0',
};

const listContainerStyle: React.CSSProperties = {
  margin: '0 0 24px 0',
};

const listItemStyle: React.CSSProperties = {
  fontSize: '14px',
  lineHeight: '1.6',
  color: '#374151',
  margin: '0 0 12px 0',
};

const buttonContainerStyle: React.CSSProperties = {
  textAlign: 'center' as const,
  margin: '24px 0',
};

const helpTextStyle: React.CSSProperties = {
  fontSize: '14px',
  color: '#6b7280',
  textAlign: 'center' as const,
  margin: '0 0 24px 0',
};

const linkStyle: React.CSSProperties = {
  color: '#4f46e5',
  textDecoration: 'none',
};

const signatureStyle: React.CSSProperties = {
  fontSize: '15px',
  lineHeight: '1.6',
  color: '#374151',
  margin: '24px 0 0 0',
};

export default MfaEnabled;

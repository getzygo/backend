/**
 * MFA Disabled Template
 *
 * Sent when a user disables two-factor authentication.
 * ALWAYS_SEND policy - cannot be disabled by user.
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

interface MfaDisabledProps {
  firstName?: string;
  disabledAt?: Date;
  ipAddress?: string;
  deviceInfo?: string;
  appUrl?: string;
}

export function MfaDisabled({
  firstName = 'there',
  disabledAt = new Date(),
  ipAddress,
  deviceInfo,
  appUrl = 'https://app.getzygo.com',
}: MfaDisabledProps) {
  const formattedDate = disabledAt.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  return (
    <Html>
      <Head />
      <Preview>Two-factor authentication has been disabled on your Zygo account</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Header />

          <Section style={contentStyle}>
            <Text style={headingStyle}>Two-factor authentication disabled</Text>

            <Text style={paragraphStyle}>Hi {firstName},</Text>

            <Text style={paragraphStyle}>
              Two-factor authentication (2FA) has been disabled on your Zygo
              account.
            </Text>

            <AlertBox variant="danger" title="Your account is less secure">
              Without two-factor authentication, your account is protected only
              by your password. We strongly recommend re-enabling 2FA to protect
              your account.
            </AlertBox>

            <Section style={detailsContainerStyle}>
              <Text style={detailsLabelStyle}>Disabled On</Text>
              <Text style={detailsValueStyle}>{formattedDate}</Text>

              {ipAddress && (
                <>
                  <Text style={detailsLabelStyle}>IP Address</Text>
                  <Text style={detailsValueStyle}>{ipAddress}</Text>
                </>
              )}

              {deviceInfo && (
                <>
                  <Text style={detailsLabelStyle}>Device</Text>
                  <Text style={detailsValueStyle}>{deviceInfo}</Text>
                </>
              )}
            </Section>

            <AlertBox variant="warning" title="Wasn't you?">
              If you did not disable two-factor authentication, your account may
              have been compromised. Please change your password immediately,
              re-enable 2FA, and contact our support team.
            </AlertBox>

            <Section style={buttonContainerStyle}>
              <Button href={`${appUrl}/settings/security`} variant="danger">
                Secure Your Account
              </Button>
            </Section>

            <Text style={helpTextStyle}>
              <Link href={`${appUrl}/settings/sessions`} style={linkStyle}>
                View all active sessions
              </Link>
              {' • '}
              <Link href="mailto:support@getzygo.com" style={linkStyle}>
                Contact support
              </Link>
            </Text>

            <Text style={signatureStyle}>
              Stay safe,
              <br />
              The Zygo Security Team
            </Text>
          </Section>

          <Footer />
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

export default MfaDisabled;

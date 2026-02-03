/**
 * Password Changed Template
 *
 * Sent when a user's password has been changed (via reset or settings).
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
import { Header, Footer, AlertBox, Button } from '../components';

interface PasswordChangedProps {
  firstName?: string;
  changedAt?: Date;
  ipAddress?: string;
  deviceInfo?: string;
}

export function PasswordChanged({
  firstName = 'there',
  changedAt = new Date(),
  ipAddress,
  deviceInfo,
}: PasswordChangedProps) {
  const formattedDate = changedAt.toLocaleDateString('en-US', {
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
      <Preview>Your Zygo password has been changed</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Header />

          <Section style={contentStyle}>
            <Text style={headingStyle}>Password changed successfully</Text>

            <Text style={paragraphStyle}>Hi {firstName},</Text>

            <Text style={paragraphStyle}>
              Your Zygo account password was successfully changed.
            </Text>

            <Section style={detailsContainerStyle}>
              <Text style={detailsLabelStyle}>When</Text>
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

            <AlertBox variant="danger" title="Wasn't you?">
              If you did not make this change, your account may have been
              compromised. Please reset your password immediately and contact our
              support team.
            </AlertBox>

            <Section style={buttonContainerStyle}>
              <Button href="https://app.getzygo.com/settings/security" variant="danger">
                Review Security Settings
              </Button>
            </Section>

            <Text style={helpTextStyle}>
              Need help?{' '}
              <Link href="mailto:support@getzygo.com" style={linkStyle}>
                Contact support
              </Link>
            </Text>

            <Text style={signatureStyle}>
              Best,
              <br />
              The Zygo Team
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

export default PasswordChanged;

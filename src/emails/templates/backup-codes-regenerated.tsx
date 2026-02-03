/**
 * Backup Codes Regenerated Template
 *
 * Sent when a user regenerates their MFA backup codes.
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

interface BackupCodesRegeneratedProps {
  firstName?: string;
  regeneratedAt?: Date;
  ipAddress?: string;
  deviceInfo?: string;
}

export function BackupCodesRegenerated({
  firstName = 'there',
  regeneratedAt = new Date(),
  ipAddress,
  deviceInfo,
}: BackupCodesRegeneratedProps) {
  const formattedDate = regeneratedAt.toLocaleDateString('en-US', {
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
      <Preview>Your Zygo backup codes have been regenerated</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Header />

          <Section style={contentStyle}>
            <Text style={headingStyle}>Backup codes regenerated</Text>

            <Text style={paragraphStyle}>Hi {firstName},</Text>

            <Text style={paragraphStyle}>
              The backup codes for your Zygo account have been regenerated. Your
              previous backup codes are no longer valid.
            </Text>

            <AlertBox variant="warning" title="Important">
              Make sure you&apos;ve saved your new backup codes in a secure location.
              You&apos;ll need them if you lose access to your two-factor
              authentication method.
            </AlertBox>

            <Section style={detailsContainerStyle}>
              <Text style={detailsLabelStyle}>Regenerated On</Text>
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

            <Text style={paragraphStyle}>
              If you didn&apos;t regenerate your backup codes, someone else may have
              access to your account. Please change your password and regenerate
              your codes immediately.
            </Text>

            <Section style={buttonContainerStyle}>
              <Button href="https://app.getzygo.com/settings/security">
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

          <Footer includeUnsubscribe={true} unsubscribeUrl="https://app.getzygo.com/settings/notifications" />
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

export default BackupCodesRegenerated;

/**
 * Session Revoked Template
 *
 * Sent when a user's session is terminated (by user or admin).
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

interface SessionRevokedProps {
  firstName?: string;
  revokedDevice?: string;
  revokedBrowser?: string;
  revokedLocation?: string;
  revokedAt?: Date;
  revokedBy?: 'user' | 'admin' | 'system';
  revokerDevice?: string;
}

export function SessionRevoked({
  firstName = 'there',
  revokedDevice = 'Unknown device',
  revokedBrowser,
  revokedLocation,
  revokedAt = new Date(),
  revokedBy = 'user',
  revokerDevice,
}: SessionRevokedProps) {
  const formattedDate = revokedAt.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  const revokerLabels = {
    user: 'You',
    admin: 'An administrator',
    system: 'Our security system',
  };

  return (
    <Html>
      <Head />
      <Preview>A session has been logged out from your Zygo account</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Header />

          <Section style={contentStyle}>
            <Text style={headingStyle}>Session logged out</Text>

            <Text style={paragraphStyle}>Hi {firstName},</Text>

            <Text style={paragraphStyle}>
              {revokerLabels[revokedBy]} logged out a session from your Zygo
              account.
            </Text>

            <Section style={detailsContainerStyle}>
              <Text style={detailsTitleStyle}>Logged out session</Text>

              <table style={detailsTableStyle}>
                <tbody>
                  <tr>
                    <td style={detailsLabelStyle}>Device</td>
                    <td style={detailsValueStyle}>{revokedDevice}</td>
                  </tr>
                  {revokedBrowser && (
                    <tr>
                      <td style={detailsLabelStyle}>Browser</td>
                      <td style={detailsValueStyle}>{revokedBrowser}</td>
                    </tr>
                  )}
                  {revokedLocation && (
                    <tr>
                      <td style={detailsLabelStyle}>Location</td>
                      <td style={detailsValueStyle}>{revokedLocation}</td>
                    </tr>
                  )}
                  <tr>
                    <td style={detailsLabelStyle}>Logged out at</td>
                    <td style={detailsValueStyle}>{formattedDate}</td>
                  </tr>
                  {revokerDevice && revokedBy === 'user' && (
                    <tr>
                      <td style={detailsLabelStyle}>Logged out from</td>
                      <td style={detailsValueStyle}>{revokerDevice}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Section>

            {revokedBy !== 'user' && (
              <AlertBox variant="warning" title="Session terminated by {revokerLabels[revokedBy].toLowerCase()}">
                {revokedBy === 'admin'
                  ? 'An administrator has terminated this session. If you have questions, please contact your organization administrator.'
                  : 'Our security system detected unusual activity and terminated this session as a precaution.'}
              </AlertBox>
            )}

            {revokedBy === 'user' && (
              <Text style={paragraphStyle}>
                If you didn&apos;t do this, someone else may have access to your
                account. We recommend changing your password immediately.
              </Text>
            )}

            <Section style={buttonContainerStyle}>
              <Button href="https://app.getzygo.com/settings/sessions">
                Manage Active Sessions
              </Button>
            </Section>

            <Text style={helpTextStyle}>
              <Link href="https://app.getzygo.com/settings/security" style={linkStyle}>
                Security settings
              </Link>
              {' • '}
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

const detailsTitleStyle: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 600,
  color: '#111827',
  margin: '0 0 12px 0',
};

const detailsTableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse' as const,
};

const detailsLabelStyle: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 600,
  color: '#6b7280',
  padding: '6px 12px 6px 0',
  verticalAlign: 'top' as const,
  width: '120px',
};

const detailsValueStyle: React.CSSProperties = {
  fontSize: '14px',
  color: '#111827',
  padding: '6px 0',
  verticalAlign: 'top' as const,
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

export default SessionRevoked;

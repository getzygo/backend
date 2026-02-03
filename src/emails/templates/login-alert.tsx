/**
 * Login Alert Template
 *
 * Sent when a new sign-in is detected from a new device, location, or browser.
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

interface LoginAlertProps {
  firstName?: string;
  alerts: string[];
  device?: string;
  browser?: string;
  os?: string;
  location?: string;
  ipAddress?: string;
  timestamp?: Date;
  isSuspicious?: boolean;
  appUrl?: string;
}

export function LoginAlert({
  firstName = 'there',
  alerts = [],
  device = 'Unknown device',
  browser,
  os,
  location = 'Unknown location',
  ipAddress,
  timestamp = new Date(),
  isSuspicious = false,
  appUrl = 'https://app.getzygo.com',
}: LoginAlertProps) {
  const formattedDate = timestamp.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  const deviceInfo = [browser, os].filter(Boolean).join(' on ');

  return (
    <Html>
      <Head />
      <Preview>
        {isSuspicious
          ? 'Suspicious sign-in detected on your Zygo account'
          : 'New sign-in to your Zygo account'}
      </Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Header />

          <Section style={contentStyle}>
            <Text style={headingStyle}>
              {isSuspicious ? 'Suspicious sign-in detected' : 'New sign-in detected'}
            </Text>

            <Text style={paragraphStyle}>Hi {firstName},</Text>

            <Text style={paragraphStyle}>
              {isSuspicious
                ? 'We detected a sign-in to your Zygo account that looks suspicious:'
                : 'We detected a new sign-in to your Zygo account:'}
            </Text>

            {alerts.length > 0 && (
              <AlertBox variant={isSuspicious ? 'danger' : 'warning'}>
                <ul style={alertListStyle}>
                  {alerts.map((alert, index) => (
                    <li key={index} style={alertItemStyle}>
                      {alert}
                    </li>
                  ))}
                </ul>
              </AlertBox>
            )}

            <Section style={detailsContainerStyle}>
              <table style={detailsTableStyle}>
                <tbody>
                  <tr>
                    <td style={detailsLabelStyle}>Device</td>
                    <td style={detailsValueStyle}>{device}</td>
                  </tr>
                  {deviceInfo && (
                    <tr>
                      <td style={detailsLabelStyle}>Browser</td>
                      <td style={detailsValueStyle}>{deviceInfo}</td>
                    </tr>
                  )}
                  <tr>
                    <td style={detailsLabelStyle}>Location</td>
                    <td style={detailsValueStyle}>{location}</td>
                  </tr>
                  {ipAddress && (
                    <tr>
                      <td style={detailsLabelStyle}>IP Address</td>
                      <td style={detailsValueStyle}>{ipAddress}</td>
                    </tr>
                  )}
                  <tr>
                    <td style={detailsLabelStyle}>Time</td>
                    <td style={detailsValueStyle}>{formattedDate}</td>
                  </tr>
                </tbody>
              </table>
            </Section>

            <Text style={paragraphStyle}>
              {isSuspicious
                ? 'If this was not you, we strongly recommend securing your account immediately.'
                : 'If this was you, no action is needed. If you don\'t recognize this activity, please secure your account.'}
            </Text>

            <Section style={buttonContainerStyle}>
              <Button
                href={`${appUrl}/settings/security`}
                variant={isSuspicious ? 'danger' : 'primary'}
              >
                Review Security Settings
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

          <Footer includeUnsubscribe={!isSuspicious} unsubscribeUrl={`${appUrl}/settings/notifications`} />
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

const alertListStyle: React.CSSProperties = {
  margin: 0,
  paddingLeft: '20px',
};

const alertItemStyle: React.CSSProperties = {
  marginBottom: '4px',
};

const detailsContainerStyle: React.CSSProperties = {
  backgroundColor: '#f9fafb',
  borderRadius: '8px',
  padding: '16px 20px',
  margin: '24px 0',
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
  width: '100px',
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

export default LoginAlert;

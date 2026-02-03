/**
 * MFA Reminder Template
 *
 * Sent to remind users to enable two-factor authentication.
 * ALWAYS_SEND policy - critical security reminder.
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

interface MfaReminderProps {
  firstName?: string;
  daysRemaining: number;
  deadlineDate: string;
  isFinal?: boolean;
  appUrl?: string;
}

export function MfaReminder({
  firstName = 'there',
  daysRemaining,
  deadlineDate,
  isFinal = false,
  appUrl = 'https://app.getzygo.com',
}: MfaReminderProps) {
  const previewText = isFinal
    ? 'Action Required: Enable 2FA by tomorrow'
    : `Enable two-factor authentication within ${daysRemaining} days`;

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Header />

          <Section style={contentStyle}>
            <Text style={headingStyle}>
              {isFinal ? 'Action Required Tomorrow' : 'Enable Two-Factor Authentication'}
            </Text>

            <Text style={paragraphStyle}>Hi {firstName},</Text>

            {isFinal ? (
              <>
                <AlertBox variant="danger" title="Action Required Tomorrow">
                  Your organization requires two-factor authentication to be enabled by{' '}
                  <strong>{deadlineDate}</strong>. Please enable it today to avoid any
                  access disruptions.
                </AlertBox>

                <Text style={paragraphStyle}>
                  Two-factor authentication (2FA) adds an extra layer of security to your
                  account. Once enabled, you'll need both your password and a verification
                  code to sign in.
                </Text>
              </>
            ) : (
              <>
                <Text style={paragraphStyle}>
                  Your organization requires all users to enable two-factor authentication
                  (2FA) for added security. You have <strong>{daysRemaining} days</strong>{' '}
                  remaining to enable 2FA on your account.
                </Text>

                <AlertBox variant="info" title="Why enable 2FA?">
                  Two-factor authentication protects your account even if your password is
                  compromised. It's one of the most effective ways to prevent unauthorized
                  access to your account.
                </AlertBox>

                <Text style={paragraphStyle}>
                  <strong>Deadline:</strong> {deadlineDate}
                </Text>
              </>
            )}

            <Section style={buttonContainerStyle}>
              <Button href={`${appUrl}/settings/security`} variant={isFinal ? 'danger' : 'primary'}>
                Enable Two-Factor Authentication
              </Button>
            </Section>

            <Section style={stepsContainerStyle}>
              <Text style={stepsHeadingStyle}>How to enable 2FA:</Text>
              <ol style={stepsListStyle}>
                <li style={stepItemStyle}>
                  Go to <strong>Settings &gt; Security</strong>
                </li>
                <li style={stepItemStyle}>
                  Click <strong>Enable Two-Factor Authentication</strong>
                </li>
                <li style={stepItemStyle}>
                  Scan the QR code with your authenticator app (Google Authenticator, Authy, etc.)
                </li>
                <li style={stepItemStyle}>
                  Enter the verification code to confirm setup
                </li>
              </ol>
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

const buttonContainerStyle: React.CSSProperties = {
  textAlign: 'center' as const,
  margin: '24px 0',
};

const stepsContainerStyle: React.CSSProperties = {
  backgroundColor: '#f9fafb',
  borderRadius: '8px',
  padding: '16px 20px',
  margin: '24px 0',
};

const stepsHeadingStyle: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 600,
  color: '#374151',
  margin: '0 0 12px 0',
};

const stepsListStyle: React.CSSProperties = {
  margin: 0,
  paddingLeft: '20px',
};

const stepItemStyle: React.CSSProperties = {
  fontSize: '14px',
  color: '#374151',
  marginBottom: '8px',
  lineHeight: '1.5',
};

const helpTextStyle: React.CSSProperties = {
  fontSize: '14px',
  color: '#6b7280',
  textAlign: 'center' as const,
  margin: '24px 0',
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

export default MfaReminder;

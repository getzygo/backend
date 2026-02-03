/**
 * Phone Verification Reminder Template
 *
 * Sent to remind users to verify their phone number.
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

interface PhoneReminderProps {
  firstName?: string;
  daysRemaining: number;
  deadlineDate: string;
  isFinal?: boolean;
  appUrl?: string;
}

export function PhoneReminder({
  firstName = 'there',
  daysRemaining,
  deadlineDate,
  isFinal = false,
  appUrl = 'https://app.getzygo.com',
}: PhoneReminderProps) {
  const previewText = isFinal
    ? 'Action Required: Verify your phone number by tomorrow'
    : `Verify your phone number within ${daysRemaining} days`;

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Header />

          <Section style={contentStyle}>
            <Text style={headingStyle}>
              {isFinal ? 'Action Required Tomorrow' : 'Verify Your Phone Number'}
            </Text>

            <Text style={paragraphStyle}>Hi {firstName},</Text>

            {isFinal ? (
              <>
                <AlertBox variant="danger" title="Action Required Tomorrow">
                  Your organization requires phone verification to be completed by{' '}
                  <strong>{deadlineDate}</strong>. Please verify your phone number today
                  to avoid any access disruptions.
                </AlertBox>

                <Text style={paragraphStyle}>
                  A verified phone number helps us keep your account secure and allows us
                  to contact you for important account-related matters.
                </Text>
              </>
            ) : (
              <>
                <Text style={paragraphStyle}>
                  Your organization requires all users to verify their phone number for
                  added security. You have <strong>{daysRemaining} days</strong> remaining
                  to complete phone verification.
                </Text>

                <AlertBox variant="info" title="Why verify your phone?">
                  Phone verification helps protect your account by enabling SMS-based
                  recovery options and allowing us to alert you about suspicious activity
                  on your account.
                </AlertBox>

                <Text style={paragraphStyle}>
                  <strong>Deadline:</strong> {deadlineDate}
                </Text>
              </>
            )}

            <Section style={buttonContainerStyle}>
              <Button href={`${appUrl}/settings/security`} variant={isFinal ? 'danger' : 'primary'}>
                Verify Phone Number
              </Button>
            </Section>

            <Section style={stepsContainerStyle}>
              <Text style={stepsHeadingStyle}>How to verify your phone:</Text>
              <ol style={stepsListStyle}>
                <li style={stepItemStyle}>
                  Go to <strong>Settings &gt; Security</strong>
                </li>
                <li style={stepItemStyle}>
                  Click <strong>Add Phone Number</strong>
                </li>
                <li style={stepItemStyle}>Enter your phone number with country code</li>
                <li style={stepItemStyle}>
                  Enter the 6-digit verification code sent via SMS
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

export default PhoneReminder;

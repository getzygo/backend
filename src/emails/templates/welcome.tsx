/**
 * Welcome Email Template
 *
 * Sent after a user verifies their email address.
 * Introduces Zygo and provides helpful links.
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
import { Header, Footer, Button } from '../components';

interface WelcomeProps {
  firstName?: string;
}

export function Welcome({ firstName = 'there' }: WelcomeProps) {
  return (
    <Html>
      <Head />
      <Preview>Welcome to Zygo - Let&apos;s get you started!</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Header />

          <Section style={contentStyle}>
            <Text style={headingStyle}>Welcome to Zygo!</Text>

            <Text style={paragraphStyle}>Hi {firstName},</Text>

            <Text style={paragraphStyle}>
              Your email has been verified and your Zygo account is now ready to
              use. We&apos;re excited to have you on board!
            </Text>

            <Text style={subheadingStyle}>What&apos;s next?</Text>

            <Section style={listContainerStyle}>
              <Text style={listItemStyle}>
                <strong>Complete your profile</strong> - Add your details to
                personalize your experience
              </Text>
              <Text style={listItemStyle}>
                <strong>Set up security</strong> - Enable two-factor
                authentication to protect your account
              </Text>
              <Text style={listItemStyle}>
                <strong>Explore Zygo</strong> - Discover all the features
                available to you
              </Text>
            </Section>

            <Section style={buttonContainerStyle}>
              <Button href="https://app.getzygo.com/dashboard">
                Go to Dashboard
              </Button>
            </Section>

            <Text style={subheadingStyle}>Need help getting started?</Text>

            <Text style={paragraphStyle}>
              Our support team is always here to help. Check out our{' '}
              <Link href="https://getzygo.com/docs" style={linkStyle}>
                documentation
              </Link>{' '}
              or{' '}
              <Link href="mailto:support@getzygo.com" style={linkStyle}>
                reach out to us
              </Link>{' '}
              if you have any questions.
            </Text>

            <Text style={signatureStyle}>
              Welcome aboard!
              <br />
              The Zygo Team
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
  fontSize: '28px',
  fontWeight: 600,
  color: '#111827',
  margin: '0 0 24px 0',
  textAlign: 'center' as const,
};

const subheadingStyle: React.CSSProperties = {
  fontSize: '18px',
  fontWeight: 600,
  color: '#111827',
  margin: '24px 0 16px 0',
};

const paragraphStyle: React.CSSProperties = {
  fontSize: '15px',
  lineHeight: '1.6',
  color: '#374151',
  margin: '0 0 16px 0',
};

const listContainerStyle: React.CSSProperties = {
  margin: '0 0 24px 0',
};

const listItemStyle: React.CSSProperties = {
  fontSize: '15px',
  lineHeight: '1.6',
  color: '#374151',
  margin: '0 0 12px 0',
  paddingLeft: '20px',
  position: 'relative' as const,
};

const buttonContainerStyle: React.CSSProperties = {
  textAlign: 'center' as const,
  margin: '32px 0',
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

export default Welcome;

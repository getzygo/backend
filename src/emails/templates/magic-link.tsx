/**
 * Magic Link Template
 *
 * Sent when a user requests passwordless sign-in via magic link.
 * Contains a secure link to sign in.
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

interface MagicLinkProps {
  firstName?: string;
  magicLinkUrl: string;
  expiresInMinutes?: number;
}

export function MagicLink({
  firstName = 'there',
  magicLinkUrl,
  expiresInMinutes = 15,
}: MagicLinkProps) {
  return (
    <Html>
      <Head />
      <Preview>Sign in to Zygo with one click</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Header />

          <Section style={contentStyle}>
            <Text style={headingStyle}>Sign in to Zygo</Text>

            <Text style={paragraphStyle}>Hi {firstName},</Text>

            <Text style={paragraphStyle}>
              Click the button below to sign in to your Zygo account. No password needed!
            </Text>

            <Section style={buttonContainerStyle}>
              <Button href={magicLinkUrl}>
                Sign in to Zygo
              </Button>
            </Section>

            <Text style={expiryStyle}>
              This link will expire in {expiresInMinutes} minutes.
            </Text>

            <AlertBox variant="warning" title="Didn't request this?">
              If you didn&apos;t request this sign-in link, you can safely ignore this
              email. Your account is secure.
            </AlertBox>

            <Text style={linkFallbackStyle}>
              Or copy and paste this link into your browser:
              <br />
              <Link href={magicLinkUrl} style={linkStyle}>
                {magicLinkUrl}
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

const buttonContainerStyle: React.CSSProperties = {
  textAlign: 'center' as const,
  margin: '24px 0',
};

const expiryStyle: React.CSSProperties = {
  fontSize: '13px',
  color: '#6b7280',
  textAlign: 'center' as const,
  margin: '0 0 24px 0',
};

const linkFallbackStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#9ca3af',
  margin: '24px 0 0 0',
  wordBreak: 'break-all' as const,
};

const linkStyle: React.CSSProperties = {
  color: '#6366f1',
  textDecoration: 'none',
};

const signatureStyle: React.CSSProperties = {
  fontSize: '15px',
  lineHeight: '1.6',
  color: '#374151',
  margin: '24px 0 0 0',
};

export default MagicLink;

/**
 * Tenant Email Verification Template
 *
 * Sent when verifying tenant settings email fields (billing email, contact email).
 * Contains a 6-digit verification code.
 */

import {
  Html,
  Head,
  Preview,
  Body,
  Container,
  Section,
  Text,
} from '@react-email/components';
import { Header, Footer } from '../components';

interface TenantEmailVerificationProps {
  code: string;
  tenantName?: string;
  fieldName: string;
  expiresInMinutes?: number;
}

export function TenantEmailVerification({
  code,
  tenantName,
  fieldName,
  expiresInMinutes = 15,
}: TenantEmailVerificationProps) {
  const displayName = tenantName ? `${tenantName}'s` : 'your';

  return (
    <Html>
      <Head />
      <Preview>Your Zygo verification code is {code}</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Header />

          <Section style={contentStyle}>
            <Text style={headingStyle}>Verify your {fieldName}</Text>

            <Text style={paragraphStyle}>
              Please use the verification code below to confirm {displayName} {fieldName}:
            </Text>

            <Section style={codeContainerStyle}>
              <Text style={codeStyle}>{code}</Text>
            </Section>

            <Text style={expiryStyle}>
              This code will expire in {expiresInMinutes} minutes.
            </Text>

            <Text style={paragraphStyle}>
              If you didn&apos;t request this verification, you can safely ignore this email.
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

const codeContainerStyle: React.CSSProperties = {
  backgroundColor: '#f3f4f6',
  borderRadius: '8px',
  padding: '24px',
  margin: '24px 0',
  textAlign: 'center' as const,
};

const codeStyle: React.CSSProperties = {
  fontSize: '36px',
  fontWeight: 700,
  letterSpacing: '8px',
  color: '#111827',
  margin: 0,
  fontFamily: 'monospace',
};

const expiryStyle: React.CSSProperties = {
  fontSize: '13px',
  color: '#6b7280',
  textAlign: 'center' as const,
  margin: '0 0 24px 0',
};

const signatureStyle: React.CSSProperties = {
  fontSize: '15px',
  lineHeight: '1.6',
  color: '#374151',
  margin: '24px 0 0 0',
};

export default TenantEmailVerification;

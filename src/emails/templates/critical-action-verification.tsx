/**
 * Critical Action Verification Email Template
 *
 * Sent when verifying critical actions like tenant deletion or account deletion.
 * Contains a 6-digit verification code with warning styling.
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

interface CriticalActionVerificationProps {
  firstName?: string;
  actionDescription: string; // e.g., "delete the workspace 'Acme Corp'"
  code: string;
  expiresInMinutes?: number;
}

export function CriticalActionVerification({
  firstName,
  actionDescription,
  code,
  expiresInMinutes = 10,
}: CriticalActionVerificationProps) {
  const displayName = firstName || 'there';

  return (
    <Html>
      <Head />
      <Preview>Security verification required - Zygo</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Header />

          <Section style={contentStyle}>
            {/* Warning Banner */}
            <Section style={warningBannerStyle}>
              <Text style={warningIconStyle}>⚠️</Text>
              <Text style={warningTextStyle}>Security Verification Required</Text>
            </Section>

            <Text style={greetingStyle}>Hi {displayName},</Text>

            <Text style={paragraphStyle}>
              You requested to <strong style={actionHighlightStyle}>{actionDescription}</strong>.
            </Text>

            <Text style={paragraphStyle}>
              To confirm this action, please enter the verification code below:
            </Text>

            <Section style={codeContainerStyle}>
              <Text style={codeStyle}>{code}</Text>
            </Section>

            <Text style={expiryStyle}>
              This code expires in <strong>{expiresInMinutes} minutes</strong>.
            </Text>

            {/* Security Notice */}
            <Section style={securityNoticeStyle}>
              <Text style={securityNoticeHeaderStyle}>🔒 Security Notice</Text>
              <Text style={securityNoticeTextStyle}>
                If you didn&apos;t request this action, please ignore this email and your account will remain secure.
                No changes will be made unless you enter this code.
              </Text>
            </Section>

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

const warningBannerStyle: React.CSSProperties = {
  backgroundColor: '#fef3c7',
  border: '1px solid #fbbf24',
  borderRadius: '8px',
  padding: '16px',
  marginBottom: '24px',
  textAlign: 'center' as const,
};

const warningIconStyle: React.CSSProperties = {
  fontSize: '24px',
  margin: '0 0 8px 0',
};

const warningTextStyle: React.CSSProperties = {
  fontSize: '16px',
  fontWeight: 600,
  color: '#92400e',
  margin: 0,
};

const greetingStyle: React.CSSProperties = {
  fontSize: '15px',
  lineHeight: '1.6',
  color: '#374151',
  margin: '0 0 16px 0',
};

const paragraphStyle: React.CSSProperties = {
  fontSize: '15px',
  lineHeight: '1.6',
  color: '#374151',
  margin: '0 0 16px 0',
};

const actionHighlightStyle: React.CSSProperties = {
  color: '#dc2626',
};

const codeContainerStyle: React.CSSProperties = {
  backgroundColor: '#f3f4f6',
  borderRadius: '8px',
  padding: '24px',
  margin: '24px 0',
  textAlign: 'center' as const,
  border: '2px dashed #d1d5db',
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
  fontSize: '14px',
  color: '#6b7280',
  textAlign: 'center' as const,
  margin: '0 0 24px 0',
};

const securityNoticeStyle: React.CSSProperties = {
  backgroundColor: '#f0fdf4',
  border: '1px solid #bbf7d0',
  borderRadius: '8px',
  padding: '16px',
  marginBottom: '24px',
};

const securityNoticeHeaderStyle: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 600,
  color: '#166534',
  margin: '0 0 8px 0',
};

const securityNoticeTextStyle: React.CSSProperties = {
  fontSize: '13px',
  lineHeight: '1.5',
  color: '#15803d',
  margin: 0,
};

const signatureStyle: React.CSSProperties = {
  fontSize: '15px',
  lineHeight: '1.6',
  color: '#374151',
  margin: '24px 0 0 0',
};

export default CriticalActionVerification;

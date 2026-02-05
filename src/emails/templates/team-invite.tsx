/**
 * Team Invite Email Template
 *
 * Sent when a user is invited to join a tenant/workspace.
 * Includes the inviter info, role, and accept link.
 *
 * Follows the same structure as magic-link.tsx for email client compatibility.
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

interface TeamInviteProps {
  inviteeName?: string;
  inviterName?: string;
  tenantName?: string;
  roleName?: string;
  message?: string;
  acceptUrl: string;
  expiresInDays?: number;
  isExistingUser?: boolean;
}

export function TeamInvite({
  inviteeName = 'there',
  inviterName = 'Someone',
  tenantName = 'a workspace',
  roleName = 'Member',
  acceptUrl,
  expiresInDays = 7,
  isExistingUser = false,
}: TeamInviteProps) {
  const expiryText = isExistingUser
    ? 'This link expires in 24 hours. After that, you can still accept by signing in to the workspace.'
    : `This invitation expires in ${expiresInDays} days.`;

  return (
    <Html>
      <Head />
      <Preview>{inviterName} invited you to join {tenantName} on Zygo</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Header />

          <Section style={contentStyle}>
            <Text style={headingStyle}>You&apos;re invited!</Text>

            <Text style={paragraphStyle}>Hi {inviteeName},</Text>

            <Text style={paragraphStyle}>
              <strong>{inviterName}</strong> has invited you to join{' '}
              <strong>{tenantName}</strong> on Zygo as a{' '}
              <strong>{roleName}</strong>.
            </Text>

            <Section style={buttonContainerStyle}>
              <Button href={acceptUrl}>Accept Invitation</Button>
            </Section>

            <Text style={expiryStyle}>{expiryText}</Text>

            <Text style={paragraphStyle}>
              If you didn&apos;t expect this invitation, you can safely ignore this
              email or contact{' '}
              <Link href="mailto:support@getzygo.com" style={linkStyle}>
                our support team
              </Link>
              .
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

export default TeamInvite;

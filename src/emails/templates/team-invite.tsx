/**
 * Team Invite Email Template
 *
 * Sent when a user is invited to join a tenant/workspace.
 * Includes the inviter info, role, and accept link.
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
  message,
  acceptUrl,
  expiresInDays = 7,
  isExistingUser = false,
}: TeamInviteProps) {
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

            {message && (
              <Section style={messageContainerStyle}>
                <Text style={messageLabelStyle}>Message from {inviterName}:</Text>
                <Text style={messageTextStyle}>&ldquo;{message}&rdquo;</Text>
              </Section>
            )}

            <Section style={buttonContainerStyle}>
              <Button href={acceptUrl}>Accept Invitation</Button>
            </Section>

            {isExistingUser && (
              <Text style={helperTextStyle}>
                Just click the button above — no sign-in needed.
              </Text>
            )}

            <Text style={expiryStyle}>
              {isExistingUser
                ? 'This link expires in 24 hours. After that, you can still accept by signing in to the workspace.'
                : `This invitation expires in ${expiresInDays} days.`}
            </Text>

            <Section style={dividerStyle} />

            <Text style={subheadingStyle}>What is Zygo?</Text>

            <Text style={paragraphStyle}>
              Zygo is an AI-powered workflow automation platform that helps teams
              build and deploy intelligent workflows. With Zygo, you can:
            </Text>

            <Section style={listContainerStyle}>
              <Text style={listItemStyle}>
                <strong>Create AI agents</strong> - Build workflows that think and adapt
              </Text>
              <Text style={listItemStyle}>
                <strong>Automate processes</strong> - Connect your tools and data sources
              </Text>
              <Text style={listItemStyle}>
                <strong>Collaborate with your team</strong> - Work together on shared workflows
              </Text>
            </Section>

            <Text style={paragraphStyle}>
              If you didn&apos;t expect this invitation or have questions, please contact{' '}
              <Link href={`mailto:${inviterName.toLowerCase().replace(/\s/g, '.')}@your-company.com`} style={linkStyle}>
                {inviterName}
              </Link>{' '}
              or{' '}
              <Link href="mailto:support@getzygo.com" style={linkStyle}>
                our support team
              </Link>
              .
            </Text>

            <Text style={signatureStyle}>
              The Zygo Team
            </Text>
          </Section>

          <Footer includeUnsubscribe={false} />
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

const messageContainerStyle: React.CSSProperties = {
  backgroundColor: '#f3f4f6',
  borderRadius: '8px',
  padding: '16px',
  margin: '24px 0',
};

const messageLabelStyle: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 500,
  color: '#6b7280',
  margin: '0 0 8px 0',
};

const messageTextStyle: React.CSSProperties = {
  fontSize: '15px',
  lineHeight: '1.6',
  color: '#374151',
  fontStyle: 'italic',
  margin: 0,
};

const buttonContainerStyle: React.CSSProperties = {
  textAlign: 'center' as const,
  margin: '32px 0',
};

const helperTextStyle: React.CSSProperties = {
  fontSize: '13px',
  color: '#6b7280',
  textAlign: 'center' as const,
  margin: '-16px 0 8px 0',
};

const expiryStyle: React.CSSProperties = {
  fontSize: '13px',
  color: '#6b7280',
  textAlign: 'center' as const,
  margin: '0 0 24px 0',
};

const dividerStyle: React.CSSProperties = {
  borderTop: '1px solid #e5e7eb',
  margin: '24px 0',
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

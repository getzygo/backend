/**
 * Tenant Deletion Cancelled Template
 *
 * Sent to all workspace members when deletion is cancelled.
 * ALWAYS_SEND policy - cannot be disabled by user.
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

interface TenantDeletionCancelledProps {
  firstName?: string;
  tenantName?: string;
  cancelledBy?: string;
  cancelledAt?: Date;
  appUrl?: string;
}

export function TenantDeletionCancelled({
  firstName = 'there',
  tenantName = 'Your workspace',
  cancelledBy = 'an administrator',
  cancelledAt = new Date(),
  appUrl = 'https://app.getzygo.com',
}: TenantDeletionCancelledProps) {
  const formattedDate = cancelledAt.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  return (
    <Html>
      <Head />
      <Preview>Good news! The deletion of {tenantName} has been cancelled</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Header />

          <Section style={contentStyle}>
            <Text style={headingStyle}>Workspace deletion cancelled</Text>

            <AlertBox variant="success" title="Good News">
              The scheduled deletion of "{tenantName}" has been cancelled.
              Your workspace and all data remain intact.
            </AlertBox>

            <Text style={paragraphStyle}>Hi {firstName},</Text>

            <Text style={paragraphStyle}>
              Great news! The deletion request for the <strong>{tenantName}</strong> workspace
              has been cancelled. Your workspace is now restored to normal operation.
            </Text>

            <Section style={detailsContainerStyle}>
              <Text style={detailsLabelStyle}>Workspace</Text>
              <Text style={detailsValueStyle}>{tenantName}</Text>

              <Text style={detailsLabelStyle}>Cancelled By</Text>
              <Text style={detailsValueStyle}>{cancelledBy}</Text>

              <Text style={detailsLabelStyle}>Cancelled At</Text>
              <Text style={detailsValueStyle}>{formattedDate}</Text>

              <Text style={detailsLabelStyle}>Status</Text>
              <Text style={detailsValueStyle}>Active</Text>
            </Section>

            <Text style={paragraphStyle}>
              <strong>What this means:</strong>
            </Text>

            <Section style={listContainerStyle}>
              <Text style={listItemStyle}>
                Your workspace is fully operational again
              </Text>
              <Text style={listItemStyle}>
                All data, settings, and configurations are preserved
              </Text>
              <Text style={listItemStyle}>
                Team members can continue working as normal
              </Text>
              <Text style={listItemStyle}>
                Your billing and subscription remain unchanged
              </Text>
            </Section>

            <Section style={buttonContainerStyle}>
              <Button href={`${appUrl}/dashboard`}>
                Go to Dashboard
              </Button>
            </Section>

            <Text style={helpTextStyle}>
              Questions?{' '}
              <Link href="mailto:support@getzygo.com" style={linkStyle}>
                Contact support
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

const detailsContainerStyle: React.CSSProperties = {
  backgroundColor: '#f0fdf4',
  borderRadius: '8px',
  padding: '16px 20px',
  margin: '24px 0',
  borderLeft: '4px solid #10b981',
};

const detailsLabelStyle: React.CSSProperties = {
  fontSize: '12px',
  fontWeight: 600,
  color: '#6b7280',
  textTransform: 'uppercase' as const,
  margin: '0 0 4px 0',
};

const detailsValueStyle: React.CSSProperties = {
  fontSize: '14px',
  color: '#111827',
  margin: '0 0 12px 0',
};

const listContainerStyle: React.CSSProperties = {
  margin: '0 0 24px 0',
  paddingLeft: '20px',
};

const listItemStyle: React.CSSProperties = {
  fontSize: '14px',
  lineHeight: '1.6',
  color: '#374151',
  margin: '0 0 8px 0',
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

export default TenantDeletionCancelled;

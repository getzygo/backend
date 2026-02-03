/**
 * Tenant Deletion Requested Template
 *
 * Sent to all workspace members when deletion is requested.
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

interface TenantDeletionRequestedProps {
  firstName?: string;
  tenantName?: string;
  deletionScheduledAt?: Date;
  cancelableUntil?: Date;
  requestedBy?: string;
  reason?: string;
  appUrl?: string;
}

export function TenantDeletionRequested({
  firstName = 'there',
  tenantName = 'Your workspace',
  deletionScheduledAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  cancelableUntil = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
  requestedBy = 'an administrator',
  reason,
  appUrl = 'https://app.getzygo.com',
}: TenantDeletionRequestedProps) {
  const formattedDeletionDate = deletionScheduledAt.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const formattedCancelDate = cancelableUntil.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const daysUntilDeletion = Math.ceil(
    (deletionScheduledAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  );

  return (
    <Html>
      <Head />
      <Preview>
        {tenantName} is scheduled for deletion on {formattedDeletionDate}
      </Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Header />

          <Section style={contentStyle}>
            <Text style={headingStyle}>Workspace deletion requested</Text>

            <AlertBox variant="danger" title="Action Required">
              The workspace "{tenantName}" has been scheduled for permanent deletion.
              All data will be archived and then removed.
            </AlertBox>

            <Text style={paragraphStyle}>Hi {firstName},</Text>

            <Text style={paragraphStyle}>
              {requestedBy} has requested the deletion of the <strong>{tenantName}</strong> workspace.
              This is a permanent action that cannot be undone after the grace period.
            </Text>

            <Section style={detailsContainerStyle}>
              <Text style={detailsLabelStyle}>Workspace</Text>
              <Text style={detailsValueStyle}>{tenantName}</Text>

              <Text style={detailsLabelStyle}>Requested By</Text>
              <Text style={detailsValueStyle}>{requestedBy}</Text>

              {reason && (
                <>
                  <Text style={detailsLabelStyle}>Reason</Text>
                  <Text style={detailsValueStyle}>{reason}</Text>
                </>
              )}

              <Text style={detailsLabelStyle}>Deletion Date</Text>
              <Text style={detailsValueStyle}>
                {formattedDeletionDate} ({daysUntilDeletion} days from now)
              </Text>

              <Text style={detailsLabelStyle}>Cancellation Deadline</Text>
              <Text style={detailsValueStyle}>{formattedCancelDate}</Text>
            </Section>

            <Text style={paragraphStyle}>
              <strong>What happens next:</strong>
            </Text>

            <Section style={listContainerStyle}>
              <Text style={listItemStyle}>
                1. You can cancel this deletion until {formattedCancelDate}
              </Text>
              <Text style={listItemStyle}>
                2. After the grace period, all data will be archived and encrypted
              </Text>
              <Text style={listItemStyle}>
                3. The workspace and all associated data will be permanently deleted
              </Text>
              <Text style={listItemStyle}>
                4. Billing records will be retained for 7 years per legal requirements
              </Text>
            </Section>

            <Section style={buttonContainerStyle}>
              <Button href={`${appUrl}/settings/danger-zone`} variant="danger">
                View Deletion Status
              </Button>
            </Section>

            <AlertBox variant="warning" title="Want to cancel?">
              If this deletion was made in error, you can cancel it from the workspace
              settings before {formattedCancelDate}. After this date, the deletion
              cannot be stopped.
            </AlertBox>

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
  backgroundColor: '#fef2f2',
  borderRadius: '8px',
  padding: '16px 20px',
  margin: '24px 0',
  borderLeft: '4px solid #ef4444',
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
  paddingLeft: '0',
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

export default TenantDeletionRequested;

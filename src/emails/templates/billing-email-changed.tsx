/**
 * Billing Email Changed Template
 *
 * Sent when a tenant's billing email address is changed.
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

interface BillingEmailChangedProps {
  tenantName?: string;
  newEmail?: string;
  changedBy?: string;
  changedAt?: Date;
  isNewAddress?: boolean;
  appUrl?: string;
}

export function BillingEmailChanged({
  tenantName = 'Your workspace',
  newEmail,
  changedBy = 'a team administrator',
  changedAt = new Date(),
  isNewAddress = false,
  appUrl = 'https://app.getzygo.com',
}: BillingEmailChangedProps) {
  const formattedDate = changedAt.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  const previewText = isNewAddress
    ? `You've been added as the billing contact for ${tenantName}`
    : `The billing email for ${tenantName} has been changed`;

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Header />

          <Section style={contentStyle}>
            <Text style={headingStyle}>
              {isNewAddress ? 'Billing contact added' : 'Billing email changed'}
            </Text>

            <Text style={paragraphStyle}>
              {isNewAddress
                ? `You have been set as the billing contact for ${tenantName} on Zygo.`
                : `The billing email address for ${tenantName} has been changed.`}
            </Text>

            <Section style={detailsContainerStyle}>
              <Text style={detailsLabelStyle}>Workspace</Text>
              <Text style={detailsValueStyle}>{tenantName}</Text>

              {newEmail && (
                <>
                  <Text style={detailsLabelStyle}>
                    {isNewAddress ? 'Billing Email' : 'New Billing Email'}
                  </Text>
                  <Text style={detailsValueStyle}>{newEmail}</Text>
                </>
              )}

              <Text style={detailsLabelStyle}>Changed By</Text>
              <Text style={detailsValueStyle}>{changedBy}</Text>

              <Text style={detailsLabelStyle}>When</Text>
              <Text style={detailsValueStyle}>{formattedDate}</Text>
            </Section>

            {isNewAddress ? (
              <Text style={paragraphStyle}>
                As the billing contact, you will receive invoices, payment
                receipts, and billing-related notifications for this workspace.
              </Text>
            ) : (
              <AlertBox variant="warning" title="Important">
                You will no longer receive billing notifications for this
                workspace at this email address.
              </AlertBox>
            )}

            <Section style={buttonContainerStyle}>
              <Button href={`${appUrl}/settings/billing`}>
                View Billing Settings
              </Button>
            </Section>

            <Text style={helpTextStyle}>
              Questions about billing?{' '}
              <Link href="mailto:billing@getzygo.com" style={linkStyle}>
                Contact our billing team
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
  backgroundColor: '#f9fafb',
  borderRadius: '8px',
  padding: '16px 20px',
  margin: '24px 0',
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

export default BillingEmailChanged;

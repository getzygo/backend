/**
 * Primary Contact Changed Template
 *
 * Sent when a tenant's primary contact is added, updated, or removed.
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

interface PrimaryContactChangedProps {
  contactName?: string;
  action?: 'added' | 'updated' | 'removed';
  changedBy?: string;
  changedAt?: Date;
  newEmail?: string;
  isNewAddress?: boolean;
  appUrl?: string;
}

export function PrimaryContactChanged({
  contactName = 'Primary Contact',
  action = 'updated',
  changedBy = 'a team administrator',
  changedAt = new Date(),
  newEmail,
  isNewAddress = false,
  appUrl = 'https://app.getzygo.com',
}: PrimaryContactChangedProps) {
  const formattedDate = changedAt.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  const getHeading = () => {
    if (isNewAddress) return 'You are now the primary contact';
    switch (action) {
      case 'added':
        return 'Primary contact added';
      case 'removed':
        return 'Primary contact removed';
      default:
        return 'Primary contact updated';
    }
  };

  const getPreviewText = () => {
    if (isNewAddress) return 'You have been set as the primary contact';
    switch (action) {
      case 'added':
        return 'A primary contact has been added to your workspace';
      case 'removed':
        return 'You have been removed as the primary contact';
      default:
        return 'The primary contact has been updated';
    }
  };

  const getMessage = () => {
    if (isNewAddress) {
      return 'You have been set as the primary contact for your Zygo workspace. As the primary contact, you will receive important communications about your account.';
    }
    switch (action) {
      case 'added':
        return `${contactName} has been added as the primary contact for your Zygo workspace.`;
      case 'removed':
        return 'You have been removed as the primary contact for your Zygo workspace. You will no longer receive primary contact communications.';
      default:
        return 'The primary contact information for your Zygo workspace has been updated.';
    }
  };

  return (
    <Html>
      <Head />
      <Preview>{getPreviewText()}</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Header />

          <Section style={contentStyle}>
            <Text style={headingStyle}>{getHeading()}</Text>

            <Text style={paragraphStyle}>{getMessage()}</Text>

            <Section style={detailsContainerStyle}>
              <Text style={detailsLabelStyle}>Contact Name</Text>
              <Text style={detailsValueStyle}>{contactName}</Text>

              {newEmail && (
                <>
                  <Text style={detailsLabelStyle}>New Email</Text>
                  <Text style={detailsValueStyle}>{newEmail}</Text>
                </>
              )}

              <Text style={detailsLabelStyle}>Changed By</Text>
              <Text style={detailsValueStyle}>{changedBy}</Text>

              <Text style={detailsLabelStyle}>When</Text>
              <Text style={detailsValueStyle}>{formattedDate}</Text>
            </Section>

            {action === 'removed' && (
              <AlertBox variant="info" title="What this means">
                You will no longer receive primary contact communications for
                this workspace. If you believe this was done in error, please
                contact your workspace administrator.
              </AlertBox>
            )}

            {isNewAddress && (
              <Text style={paragraphStyle}>
                As the primary contact, you are responsible for:
              </Text>
            )}

            {isNewAddress && (
              <Section style={listContainerStyle}>
                <Text style={listItemStyle}>
                  Receiving important account notifications
                </Text>
                <Text style={listItemStyle}>
                  Being the main point of contact for Zygo support
                </Text>
                <Text style={listItemStyle}>
                  Receiving security and compliance communications
                </Text>
              </Section>
            )}

            <Section style={buttonContainerStyle}>
              <Button href={`${appUrl}/settings/contacts`}>
                View Contact Settings
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

export default PrimaryContactChanged;

/**
 * Trial Expiration Reminder Template
 *
 * Sent to remind tenant owners before their free trial ends.
 * ALLOW_DISABLE policy - users can unsubscribe from these emails.
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
import { Header, Footer, Button, AlertBox } from '../components';

interface TrialReminderProps {
  firstName?: string;
  tenantName?: string;
  daysRemaining: number;
  expirationDate: string;
  isFinal?: boolean;
  appUrl?: string;
}

export function TrialReminder({
  firstName = 'there',
  tenantName = 'your organization',
  daysRemaining,
  expirationDate,
  isFinal = false,
  appUrl = 'https://app.getzygo.com',
}: TrialReminderProps) {
  const previewText = isFinal
    ? `Your ${tenantName} trial ends tomorrow`
    : `Your ${tenantName} trial ends in ${daysRemaining} days`;

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Header />

          <Section style={contentStyle}>
            <Text style={headingStyle}>
              {isFinal ? 'Your Trial Ends Tomorrow' : `Your Trial Ends in ${daysRemaining} Days`}
            </Text>

            <Text style={paragraphStyle}>Hi {firstName},</Text>

            {isFinal ? (
              <>
                <AlertBox variant="warning" title="Trial Ending Tomorrow">
                  Your free trial for <strong>{tenantName}</strong> ends on{' '}
                  <strong>{expirationDate}</strong>. Upgrade now to keep your data and
                  continue using all features.
                </AlertBox>

                <Text style={paragraphStyle}>
                  After your trial ends, your workspace will be placed on a limited free
                  plan. Upgrade today to maintain full access to all features.
                </Text>
              </>
            ) : (
              <>
                <Text style={paragraphStyle}>
                  Your free trial for <strong>{tenantName}</strong> is ending soon. You
                  have <strong>{daysRemaining} days</strong> left to explore all premium
                  features.
                </Text>

                <Text style={paragraphStyle}>
                  <strong>Trial ends:</strong> {expirationDate}
                </Text>
              </>
            )}

            <Section style={buttonContainerStyle}>
              <Button href={`${appUrl}/settings/billing`} variant="primary">
                Upgrade Now
              </Button>
            </Section>

            <Section style={benefitsContainerStyle}>
              <Text style={benefitsHeadingStyle}>
                What you'll keep with a paid plan:
              </Text>
              <ul style={benefitsListStyle}>
                <li style={benefitItemStyle}>
                  <span style={checkStyle}>&#10003;</span> All your data and configurations
                </li>
                <li style={benefitItemStyle}>
                  <span style={checkStyle}>&#10003;</span> Unlimited team members
                </li>
                <li style={benefitItemStyle}>
                  <span style={checkStyle}>&#10003;</span> Advanced security features (SSO, audit logs)
                </li>
                <li style={benefitItemStyle}>
                  <span style={checkStyle}>&#10003;</span> Priority support
                </li>
                <li style={benefitItemStyle}>
                  <span style={checkStyle}>&#10003;</span> Custom integrations
                </li>
              </ul>
            </Section>

            <Section style={comparisonContainerStyle}>
              <Text style={comparisonHeadingStyle}>What changes after trial:</Text>
              <table style={comparisonTableStyle}>
                <tbody>
                  <tr>
                    <td style={comparisonLabelStyle}>Team members</td>
                    <td style={comparisonValueStyle}>Limited to 3</td>
                  </tr>
                  <tr>
                    <td style={comparisonLabelStyle}>Storage</td>
                    <td style={comparisonValueStyle}>1 GB limit</td>
                  </tr>
                  <tr>
                    <td style={comparisonLabelStyle}>Integrations</td>
                    <td style={comparisonValueStyle}>Basic only</td>
                  </tr>
                  <tr>
                    <td style={comparisonLabelStyle}>Support</td>
                    <td style={comparisonValueStyle}>Community only</td>
                  </tr>
                </tbody>
              </table>
            </Section>

            <Text style={helpTextStyle}>
              Questions about pricing?{' '}
              <Link href={`${appUrl}/pricing`} style={linkStyle}>
                View plans
              </Link>
              {' or '}
              <Link href="mailto:sales@getzygo.com" style={linkStyle}>
                contact sales
              </Link>
            </Text>

            <Text style={signatureStyle}>
              Best regards,
              <br />
              The Zygo Team
            </Text>
          </Section>

          <Footer
            includeUnsubscribe={true}
            unsubscribeUrl={`${appUrl}/settings/notifications`}
          />
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

const benefitsContainerStyle: React.CSSProperties = {
  backgroundColor: '#f0fdf4',
  borderRadius: '8px',
  padding: '16px 20px',
  margin: '24px 0',
};

const benefitsHeadingStyle: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 600,
  color: '#166534',
  margin: '0 0 12px 0',
};

const benefitsListStyle: React.CSSProperties = {
  margin: 0,
  paddingLeft: '0',
  listStyle: 'none',
};

const benefitItemStyle: React.CSSProperties = {
  fontSize: '14px',
  color: '#166534',
  marginBottom: '8px',
  lineHeight: '1.5',
};

const checkStyle: React.CSSProperties = {
  color: '#22c55e',
  marginRight: '8px',
  fontWeight: 'bold',
};

const comparisonContainerStyle: React.CSSProperties = {
  backgroundColor: '#fef3c7',
  borderRadius: '8px',
  padding: '16px 20px',
  margin: '24px 0',
};

const comparisonHeadingStyle: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 600,
  color: '#92400e',
  margin: '0 0 12px 0',
};

const comparisonTableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse' as const,
};

const comparisonLabelStyle: React.CSSProperties = {
  fontSize: '13px',
  color: '#92400e',
  padding: '4px 12px 4px 0',
  verticalAlign: 'top' as const,
};

const comparisonValueStyle: React.CSSProperties = {
  fontSize: '13px',
  color: '#92400e',
  padding: '4px 0',
  verticalAlign: 'top' as const,
  textAlign: 'right' as const,
};

const helpTextStyle: React.CSSProperties = {
  fontSize: '14px',
  color: '#6b7280',
  textAlign: 'center' as const,
  margin: '24px 0',
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

export default TrialReminder;

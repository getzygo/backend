/**
 * Email Footer Component
 *
 * Includes links to Privacy Policy, Terms, support email, and physical address.
 * Required for CAN-SPAM compliance and spam filter friendliness.
 */

import {
  Section,
  Text,
  Link,
  Hr,
} from '@react-email/components';

interface FooterProps {
  includeUnsubscribe?: boolean;
  unsubscribeUrl?: string;
}

export function Footer({ includeUnsubscribe = false, unsubscribeUrl }: FooterProps) {
  return (
    <Section style={footerStyle}>
      <Hr style={hrStyle} />

      <Text style={linksStyle}>
        <Link href="https://getzygo.com/privacy" style={linkStyle}>
          Privacy Policy
        </Link>
        {' • '}
        <Link href="https://getzygo.com/terms" style={linkStyle}>
          Terms of Service
        </Link>
        {' • '}
        <Link href="mailto:support@getzygo.com" style={linkStyle}>
          Contact Support
        </Link>
      </Text>

      {includeUnsubscribe && unsubscribeUrl && (
        <Text style={unsubscribeStyle}>
          <Link href={unsubscribeUrl} style={linkStyle}>
            Unsubscribe from these emails
          </Link>
        </Text>
      )}

      <Text style={addressStyle}>
        ZYGO AI Technologies
        <br />
        Budapest, Hungary
      </Text>

      <Text style={copyrightStyle}>
        © {new Date().getFullYear()} Zygo. All rights reserved.
      </Text>
    </Section>
  );
}

const footerStyle: React.CSSProperties = {
  marginTop: '32px',
  textAlign: 'center' as const,
};

const hrStyle: React.CSSProperties = {
  borderColor: '#e5e7eb',
  margin: '24px 0',
};

const linksStyle: React.CSSProperties = {
  fontSize: '13px',
  color: '#6b7280',
  margin: '0 0 16px 0',
};

const linkStyle: React.CSSProperties = {
  color: '#4f46e5',
  textDecoration: 'none',
};

const unsubscribeStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#9ca3af',
  margin: '0 0 16px 0',
};

const addressStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#9ca3af',
  lineHeight: '1.5',
  margin: '0 0 8px 0',
};

const copyrightStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#9ca3af',
  margin: '0',
};

export default Footer;

/**
 * Email Header Component
 *
 * Displays Zygo logo and branding at the top of emails.
 * Uses hosted logo URL for better email client compatibility.
 */

import {
  Img,
  Section,
  Row,
  Column,
} from '@react-email/components';

interface HeaderProps {
  logoUrl?: string;
}

export function Header({ logoUrl = 'https://demo.zygo.tech/logo.png' }: HeaderProps) {
  return (
    <Section style={headerStyle}>
      <Row>
        <Column align="center">
          <Img
            src={logoUrl}
            alt="Zygo"
            width="48"
            height="48"
            style={logoStyle}
          />
        </Column>
      </Row>
    </Section>
  );
}

const headerStyle: React.CSSProperties = {
  padding: '24px 0',
  borderBottom: '1px solid #e5e7eb',
  marginBottom: '32px',
};

const logoStyle: React.CSSProperties = {
  display: 'block',
  margin: '0 auto',
};

export default Header;

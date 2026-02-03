/**
 * Email Button Component
 *
 * CTA button for emails with consistent styling.
 * Uses table-based approach for maximum email client compatibility.
 */

import { Button as ReactEmailButton } from '@react-email/components';

type ButtonVariant = 'primary' | 'secondary' | 'danger';

interface ButtonProps {
  href: string;
  children: React.ReactNode;
  variant?: ButtonVariant;
}

const variantStyles: Record<ButtonVariant, React.CSSProperties> = {
  primary: {
    backgroundColor: '#4f46e5',
    color: '#ffffff',
  },
  secondary: {
    backgroundColor: '#f3f4f6',
    color: '#374151',
  },
  danger: {
    backgroundColor: '#dc2626',
    color: '#ffffff',
  },
};

export function Button({ href, children, variant = 'primary' }: ButtonProps) {
  const variantStyle = variantStyles[variant];

  return (
    <ReactEmailButton
      href={href}
      style={{
        ...baseButtonStyle,
        ...variantStyle,
      }}
    >
      {children}
    </ReactEmailButton>
  );
}

const baseButtonStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '12px 24px',
  fontSize: '14px',
  fontWeight: 600,
  textDecoration: 'none',
  textAlign: 'center' as const,
  borderRadius: '6px',
  lineHeight: '1.5',
};

export default Button;

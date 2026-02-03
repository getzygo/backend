/**
 * Email AlertBox Component
 *
 * Warning/info boxes for security alerts and important notifications.
 */

import { Section, Text } from '@react-email/components';

type AlertVariant = 'info' | 'warning' | 'danger' | 'success';

interface AlertBoxProps {
  variant?: AlertVariant;
  title?: string;
  children: React.ReactNode;
}

const variantStyles: Record<AlertVariant, { bg: string; border: string; text: string }> = {
  info: {
    bg: '#eff6ff',
    border: '#3b82f6',
    text: '#1e40af',
  },
  warning: {
    bg: '#fffbeb',
    border: '#f59e0b',
    text: '#92400e',
  },
  danger: {
    bg: '#fef2f2',
    border: '#ef4444',
    text: '#991b1b',
  },
  success: {
    bg: '#f0fdf4',
    border: '#22c55e',
    text: '#166534',
  },
};

export function AlertBox({ variant = 'info', title, children }: AlertBoxProps) {
  const colors = variantStyles[variant];

  return (
    <Section
      style={{
        ...alertStyle,
        backgroundColor: colors.bg,
        borderLeftColor: colors.border,
      }}
    >
      {title && (
        <Text
          style={{
            ...titleStyle,
            color: colors.text,
          }}
        >
          {title}
        </Text>
      )}
      <Text
        style={{
          ...contentStyle,
          color: colors.text,
        }}
      >
        {children}
      </Text>
    </Section>
  );
}

const alertStyle: React.CSSProperties = {
  padding: '16px 20px',
  borderLeft: '4px solid',
  borderRadius: '4px',
  margin: '24px 0',
};

const titleStyle: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 600,
  margin: '0 0 8px 0',
};

const contentStyle: React.CSSProperties = {
  fontSize: '14px',
  margin: '0',
  lineHeight: '1.5',
};

export default AlertBox;

interface BadgeProps {
  label: string;
  variant?: 'primary' | 'secondary' | 'accent' | 'success' | 'warning' | 'error' | 'ghost';
}

export function Badge({ label, variant = 'ghost' }: BadgeProps) {
  return (
    <span data-testid="badge" className={`badge badge-${variant} badge-sm`}>
      {label}
    </span>
  );
}

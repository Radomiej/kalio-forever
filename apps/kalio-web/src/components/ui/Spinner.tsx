interface SpinnerProps {
  size?: 'xs' | 'sm' | 'md' | 'lg';
}

export function Spinner({ size = 'md' }: SpinnerProps) {
  return (
    <span
      data-testid="spinner"
      className={`loading loading-spinner loading-${size}`}
    />
  );
}

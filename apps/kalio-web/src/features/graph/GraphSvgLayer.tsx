import type { ReactNode, SVGProps } from 'react';

export function GraphSvgLayer({
  ariaHidden = true,
  children,
  className = '',
  height,
  pointerEvents = 'none',
  testId,
  width,
}: {
  ariaHidden?: boolean;
  children: ReactNode;
  className?: string;
  height?: number;
  pointerEvents?: 'auto' | 'none';
  testId?: string;
  width?: number;
}) {
  const pointerClass = pointerEvents === 'none' ? 'pointer-events-none' : '';
  const sizeClass = width === undefined && height === undefined ? 'h-full w-full' : '';
  const svgProps: SVGProps<SVGSVGElement> = {
    'aria-hidden': ariaHidden,
    className: `${pointerClass} absolute inset-0 ${sizeClass} overflow-visible ${className}`.trim(),
    height,
    width,
  };

  return (
    <svg {...svgProps} data-testid={testId}>
      {children}
    </svg>
  );
}

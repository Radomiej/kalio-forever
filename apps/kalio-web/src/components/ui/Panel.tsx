import type { ReactNode } from 'react';

interface PanelProps {
  children: ReactNode;
  title?: string;
  className?: string;
}

export function Panel({ children, title, className = '' }: PanelProps) {
  return (
    <div data-testid="panel" className={`flex flex-col rounded-xl border border-base-300 bg-base-200 ${className}`}>
      {title && (
        <div data-testid="panel-title" className="border-b border-base-300 px-4 py-2 text-sm font-semibold">
          {title}
        </div>
      )}
      <div className="flex-1 overflow-hidden">{children}</div>
    </div>
  );
}

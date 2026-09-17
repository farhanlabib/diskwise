import type { ReactNode } from 'react';

export function DetailPanel({
  children,
  width = 320,
}: {
  children?: ReactNode;
  width?: number;
}) {
  return (
    <div
      className="flex-none overflow-y-auto border-l border-border bg-card p-[24px]"
      style={{ width }}
    >
      {children}
    </div>
  );
}

export function DetailSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mt-[18px] mb-[6px] text-[11px] [font-weight:600] uppercase tracking-[0.05em] text-text3">
        {label}
      </div>
      <div className="text-[12.5px] leading-[1.55] text-text">{children}</div>
    </div>
  );
}

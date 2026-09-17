import type { ReactNode } from 'react';

export function TrapCard({
  title,
  children,
  tone = 'good',
}: {
  title?: string;
  children: ReactNode;
  tone?: 'good' | 'neutral';
}) {
  if (tone === 'neutral') {
    return (
      <div className="mt-[12px] rounded-[9px] border border-card-line bg-card p-[16px]">
        <div className="text-[12.5px] leading-[1.55] text-text2">{children}</div>
      </div>
    );
  }

  return (
    <div className="rounded-[9px] border border-t0-line bg-t0-soft p-[16px]">
      <div className="mb-[8px] flex items-center gap-[8px]">
        <span className="text-[15px] text-t0-fg">✓</span>
        <span className="text-[13.5px] [font-weight:600] text-t0-fg">{title}</span>
      </div>
      <div className="text-[12.5px] leading-[1.5] text-text2">{children}</div>
    </div>
  );
}

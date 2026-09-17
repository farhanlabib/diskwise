import { formatBytes } from '../lib/format';

export function SelectionFooter({
  count,
  totalBytes,
  onReview,
  disabled = false,
}: {
  count: number;
  totalBytes: number;
  onReview: () => void;
  disabled?: boolean;
}) {
  const canReview = !disabled && count > 0;
  return (
    <div className="flex flex-none items-center gap-[14px] border-t border-border bg-toolbar px-[26px] py-[13px]">
      <div className="text-[13px]">
        <span className="[font-weight:600]">{count} items</span>{' '}
        <span className="text-text2">selected · {formatBytes(totalBytes)} · Dry run preview</span>
      </div>
      <span className="flex-1" />
      <button
        type="button"
        onClick={onReview}
        disabled={!canReview}
        className="rounded-[8px] border-none px-[18px] py-[9px] text-[13px] [font-weight:600]"
        style={{
          cursor: canReview ? 'pointer' : 'not-allowed',
          background: canReview ? 'var(--accent)' : 'var(--border)',
          color: canReview ? 'var(--accent-fg)' : 'var(--text3)',
        }}
      >
        Review plan…
      </button>
    </div>
  );
}

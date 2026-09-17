export type BadgeVariant = 'needs-root' | 'permanent-only' | 'app-running';

const STYLES: Record<BadgeVariant, string> = {
  'needs-root': 'bg-root-soft text-root-fg border-root-line',
  'permanent-only': 'bg-t3-soft text-t3-fg border-t3-line',
  'app-running': 'bg-t2-soft text-t2-fg border-t2-line',
};

const LABELS: Record<BadgeVariant, string> = {
  'needs-root': 'Needs root',
  'permanent-only': 'Permanent only',
  'app-running': 'App running',
};

function BadgeIcon({ variant }: { variant: BadgeVariant }) {
  if (variant === 'needs-root') {
    return (
      <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
        <rect x="0.7" y="0.9" width="6.6" height="6.2" rx="1.1" stroke="currentColor" strokeWidth="1.1" fill="none" />
        <path d="M2.2 3.1 3.5 4.2 2.2 5.3" stroke="currentColor" strokeWidth="1" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M4.2 5.4h1.6" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      </svg>
    );
  }
  if (variant === 'permanent-only') {
    return (
      <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
        <circle cx="4" cy="4" r="3.2" stroke="currentColor" strokeWidth="1.1" fill="none" />
        <path d="M1.7 1.7 6.3 6.3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
      <circle cx="4" cy="4" r="3.2" fill="currentColor" />
    </svg>
  );
}

export function Badge({ variant, label }: { variant: BadgeVariant; label?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-[4px] whitespace-nowrap rounded-[5px] border px-[8px] py-[2px] text-[10.5px] [font-weight:600] ${STYLES[variant]}`}
    >
      <BadgeIcon variant={variant} />
      {label ?? LABELS[variant]}
    </span>
  );
}

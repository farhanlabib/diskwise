import type { Tier } from '@macsweep/core/types';

export const TIER_LABEL: Record<Tier, string> = {
  0: 'Regenerates',
  1: 'Re-download',
  2: 'Your data',
  3: 'Protected',
};

export const TIER_SHORT: Record<Tier, string> = {
  0: 'Tier 0',
  1: 'Tier 1',
  2: 'Tier 2',
  3: 'Tier 3',
};

export const TIER_CLASS: Record<Tier, string> = {
  0: 'bg-t0-soft text-t0-fg border-t0-line',
  1: 'bg-t1-soft text-t1-fg border-t1-line',
  2: 'bg-t2-soft text-t2-fg border-t2-line',
  3: 'bg-t3-soft text-t3-fg border-t3-line',
};

function TierIcon({ tier }: { tier: Tier }) {
  if (tier === 0) {
    return (
      <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
        <circle cx="4" cy="4" r="3.2" fill="currentColor" />
      </svg>
    );
  }
  if (tier === 1) {
    return (
      <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
        <path d="M4 0.5v5M1.5 3.5 4 6l2.5-2.5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (tier === 2) {
    return (
      <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
        <path d="M1.2 0.8h3.4l2.2 2.2v4.2H1.2z" stroke="currentColor" strokeWidth="1.1" fill="none" strokeLinejoin="round" />
        <path d="M4.4 0.9v2.2h2.2" stroke="currentColor" strokeWidth="1.1" fill="none" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
      <rect x="1.2" y="3.3" width="5.6" height="4.2" rx="1" fill="currentColor" />
      <path d="M2.6 3.3V2.2a1.4 1.4 0 0 1 2.8 0v1.1" stroke="currentColor" strokeWidth="1.1" fill="none" />
    </svg>
  );
}

export function TierBadge({
  tier,
  label,
  short = false,
}: {
  tier: Tier;
  label?: string;
  short?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-[4px] whitespace-nowrap rounded-[5px] border px-[8px] py-[2px] text-[10.5px] [font-weight:600] ${TIER_CLASS[tier]}`}
    >
      <TierIcon tier={tier} />
      {label ?? (short ? TIER_SHORT[tier] : TIER_LABEL[tier])}
    </span>
  );
}

import { useEffect, useMemo, useState } from 'react';
import type { Category, Finding, Tier } from '@macsweep/core/types';
import { Badge } from '../components/Badge';
import { DetailPanel, DetailSection } from '../components/DetailPanel';
import { EmptyState } from '../components/EmptyState';
import { SelectionFooter } from '../components/SelectionFooter';
import { TierBadge } from '../components/TierBadge';
import { formatBytes } from '../lib/format';

const TIER_ORDER: Tier[] = [0, 1, 2, 3];

const TIER_DESC: Record<Tier, string> = {
  0: 'Deleted permanently — rebuilds automatically',
  1: 'Deleted permanently — re-downloads when needed',
  2: 'Moved to Trash — you can undo',
  3: 'Explained only — never actionable',
};

const CATEGORIES: { label: string; value: Category | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Developer', value: 'dev' },
  { label: 'System', value: 'system' },
  { label: 'Browser', value: 'browser' },
  { label: 'Your data', value: 'user-data' },
];

function canCheck(finding: Finding): boolean {
  return finding.tier !== 3 && !finding.needsRoot;
}

export function Cleanup({
  findings,
  selected,
  onToggle,
  onOpenReview,
}: {
  findings: Finding[];
  selected: Record<string, boolean>;
  onToggle: (ruleId: string) => void;
  onOpenReview: () => void;
}) {
  const [category, setCategory] = useState<Category | 'all'>('all');
  const [selectedId, setSelectedId] = useState(findings[0]?.ruleId ?? '');

  const visible = useMemo(
    () => findings.filter((finding) => category === 'all' || finding.category === category),
    [findings, category],
  );

  useEffect(() => {
    if (visible.length > 0 && !visible.some((finding) => finding.ruleId === selectedId)) {
      setSelectedId(visible[0]?.ruleId ?? '');
    }
  }, [visible, selectedId]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const index = visible.findIndex((finding) => finding.ruleId === selectedId);
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        const next = visible[Math.min(index + 1, visible.length - 1)];
        if (next) setSelectedId(next.ruleId);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        const next = visible[Math.max(index - 1, 0)];
        if (next) setSelectedId(next.ruleId);
      } else if (event.key === ' ') {
        const current = visible[index];
        if (current && canCheck(current)) {
          event.preventDefault();
          onToggle(current.ruleId);
        }
      } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onOpenReview();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [visible, selectedId, onToggle, onOpenReview]);

  const selectedItems = findings.filter((finding) => selected[finding.ruleId]);
  const selectedBytes = selectedItems.reduce(
    (sum, finding) => sum + finding.totals.allocated,
    0,
  );
  const detail = findings.find((finding) => finding.ruleId === selectedId) ?? visible[0];

  return (
    <div className="flex min-h-0 flex-1">
      <div className="w-[180px] flex-none overflow-y-auto border-r border-border px-[14px] py-[20px]">
        <div className="mb-[8px] text-[11px] [font-weight:600] uppercase tracking-[0.05em] text-text3">
          Category
        </div>
        {CATEGORIES.map((entry) => {
          const active = entry.value === category;
          return (
            <button
              key={entry.value}
              type="button"
              onClick={() => setCategory(entry.value)}
              className={`mb-[2px] block w-full cursor-pointer rounded-[7px] px-[10px] py-[7px] text-left text-[12.5px] text-text ${
                active ? 'bg-active [font-weight:600]' : 'bg-transparent [font-weight:450]'
              }`}
            >
              {entry.label}
            </button>
          );
        })}
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex-1 overflow-y-auto px-[26px] pt-[22px] pb-[24px]">
          <div className="mb-[4px] text-[22px] [font-weight:640] tracking-[-0.02em]">Cleanup</div>
          <div className="mb-[18px] text-[12.5px] text-text2">
            Select what to reclaim. Every item explains why it's safe and what it costs to get
            back.
          </div>

          {visible.length === 0 ? (
            <EmptyState message="Nothing to clean in this tier — nice." />
          ) : (
            TIER_ORDER.map((tier) => {
              const items = visible.filter((finding) => finding.tier === tier);
              if (items.length === 0) return null;
              const tierTotal = items
                .filter((finding) => selected[finding.ruleId])
                .reduce((sum, finding) => sum + finding.totals.allocated, 0);
              return (
                <div key={tier} className="mb-[22px]">
                  <div className="mb-[9px] flex items-center gap-[8px]">
                    <TierBadge tier={tier} />
                    <span className="text-[12.5px] text-text2">{TIER_DESC[tier]}</span>
                    <span className="flex-1" />
                    <span className="font-mono text-[12px] text-text3">
                      {tierTotal > 0 ? `${formatBytes(tierTotal)} selected` : ''}
                    </span>
                  </div>
                  <div className="flex flex-col gap-[6px]">
                    {items.map((finding) => {
                      const checked = Boolean(selected[finding.ruleId]);
                      const checkable = canCheck(finding);
                      const isSel = finding.ruleId === selectedId;
                      return (
                        <button
                          key={finding.ruleId}
                          type="button"
                          onClick={() => setSelectedId(finding.ruleId)}
                          className="flex cursor-pointer items-center gap-[11px] rounded-[9px] border px-[14px] py-[11px] text-left"
                          style={{
                            borderColor: isSel ? 'var(--sel-line)' : 'var(--card-line)',
                            background: isSel ? 'var(--sel)' : 'var(--card)',
                          }}
                        >
                          {checkable ? (
                            <span
                              role="checkbox"
                              aria-checked={checked}
                              onClick={(event) => {
                                event.stopPropagation();
                                onToggle(finding.ruleId);
                              }}
                              className="flex h-[18px] w-[18px] flex-none cursor-pointer items-center justify-center rounded-[5px] text-[12px] text-white"
                              style={{
                                border: `1.5px solid ${checked ? 'var(--accent)' : 'var(--border)'}`,
                                background: checked ? 'var(--accent)' : 'transparent',
                              }}
                            >
                              {checked ? '✓' : ''}
                            </span>
                          ) : null}
                          {finding.needsRoot ? <Badge variant="needs-root" label="" /> : null}
                          <div className="min-w-0 flex-1">
                            <div className="text-[13px] [font-weight:550]">{finding.title}</div>
                            <div className="mt-[2px] truncate font-mono text-[11px] text-text3">
                              {finding.matches[0]?.detail ?? finding.rationale}
                            </div>
                          </div>
                          {finding.blockedBy && finding.blockedBy.length > 0 ? (
                            <span className="rounded-[5px] bg-t2-soft px-[7px] py-[2px] text-[10.5px] text-t2-fg">
                              {finding.blockedBy[0]} is running
                            </span>
                          ) : null}
                          {finding.permanentOnly ? (
                            <Badge variant="permanent-only" label="" />
                          ) : null}
                          <span className="min-w-[60px] text-right font-mono text-[13px] [font-weight:600]">
                            {formatBytes(finding.totals.allocated)}
                          </span>
                          <TierBadge tier={tier} short />
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
        <SelectionFooter
          count={selectedItems.length}
          totalBytes={selectedBytes}
          onReview={onOpenReview}
        />
      </div>

      <DetailPanel width={340}>
        {detail ? (
          <div>
            <TierBadge tier={detail.tier} />
            <div className="mt-[12px] mb-[2px] text-[16px] [font-weight:640] tracking-[-0.01em]">
              {detail.title}
            </div>
            <div className="font-mono text-[11.5px] text-text2">
              {detail.matches[0]?.detail ?? ''}
            </div>
            <DetailSection label="Why it's safe">{detail.rationale}</DetailSection>
            <DetailSection label="Cost to get back">{detail.regeneration}</DetailSection>
            <div className="mt-[16px] mb-[6px] text-[11px] [font-weight:600] uppercase tracking-[0.05em] text-text3">
              Exact action
            </div>
            <div className="rounded-[8px] border border-border bg-win px-[12px] py-[11px]">
              <div className="font-mono text-[11.5px] break-all">
                {detail.manualCommand ?? detail.action ?? '(explained only)'}
              </div>
            </div>
            <div className="mt-[16px] mb-[6px] text-[11px] [font-weight:600] uppercase tracking-[0.05em] text-text3">
              Paths
            </div>
            {detail.matches.map((match) => (
              <div
                key={match.path ?? match.detail}
                className="flex items-center gap-[8px] py-[6px]"
              >
                <span className="flex-1 font-mono text-[11px] break-all text-text2">
                  {match.path ?? '(virtual)'}
                </span>
                <button
                  type="button"
                  className="cursor-pointer border-none bg-transparent text-[10.5px] text-accent"
                >
                  Reveal
                </button>
              </div>
            ))}
            {detail.needsRoot ? (
              <div className="mt-[14px]">
                <Badge variant="needs-root" />
              </div>
            ) : null}
            {detail.permanentOnly ? (
              <div className="mt-[8px]">
                <Badge variant="permanent-only" />
              </div>
            ) : null}
          </div>
        ) : null}
      </DetailPanel>
    </div>
  );
}

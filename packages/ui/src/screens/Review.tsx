import { useEffect, useState } from 'react';
import type { CleanupPlan, PlanItem, Tier } from '@diskwise/core/types';
import { TierBadge } from '../components/TierBadge';
import { TypedConfirmField } from '../components/TypedConfirmField';
import { formatBytes } from '../lib/format';

interface Group {
  key: string;
  tier: Tier;
  label: string;
  items: PlanItem[];
}

const GROUP_ORDER: { key: string; tier: Tier; label: string }[] = [
  { key: 'tier0', tier: 0, label: 'Deleted permanently (rebuilds automatically)' },
  { key: 'tier1', tier: 1, label: 'Deleted permanently (re-downloads when needed)' },
  { key: 'trash', tier: 2, label: 'Moved to Trash (you can undo)' },
];

function groupKey(item: PlanItem): string {
  if (item.action === 'trash-path') return 'trash';
  if (item.tier === 0) return 'tier0';
  return 'tier1';
}

export function Review({
  plan,
  onCancel,
  onConfirm,
}: {
  plan: CleanupPlan;
  onCancel: () => void;
  onConfirm: (confirmedRuleIds: string[]) => void;
}) {
  const [confirmValues, setConfirmValues] = useState<Record<string, string>>({});

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onCancel]);

  const groups: Group[] = GROUP_ORDER.map((entry) => ({
    key: entry.key,
    tier: entry.tier,
    label: entry.label,
    items: plan.items.filter((item) => groupKey(item) === entry.key),
  })).filter((group) => group.items.length > 0);

  const confirmRules = [
    ...new Set(plan.items.filter((item) => item.needsConfirmation).map((item) => item.ruleId)),
  ];
  const allConfirmed = confirmRules.every(
    (ruleId) => (confirmValues[ruleId] ?? '').trim() === ruleId,
  );

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,0.35)] p-[40px] backdrop-blur-[2px]">
      <div className="flex max-h-full w-full max-w-[560px] flex-col overflow-hidden rounded-[12px] bg-win shadow-window">
        <div className="px-[26px] pt-[22px] pb-[14px]">
          <div className="text-[19px] [font-weight:660] tracking-[-0.02em]">Review plan</div>
          <div className="mt-[3px] text-[12.5px] text-text2">
            Nothing is deleted until you confirm. Here's exactly what happens.
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-[26px]">
          {groups.map((group) => (
            <div key={group.key} className="border-t border-border2 py-[14px]">
              <div className="flex items-center gap-[9px]">
                <TierBadge tier={group.tier} />
                <span className="flex-1 text-[12.5px] [font-weight:600]">{group.label}</span>
                <span className="font-mono text-[13px] [font-weight:600]">
                  {formatBytes(
                    group.items.reduce((sum, item) => sum + item.match.bytesAllocated, 0),
                  )}
                </span>
              </div>
              <div className="mt-[6px] text-[11.5px] text-text3">
                {[...new Set(group.items.map((item) => item.title))].join(' · ')}
              </div>
            </div>
          ))}
          {confirmRules.map((ruleId) => (
            <div key={ruleId} className="border-t border-border2 py-[16px]">
              <TypedConfirmField
                expected={ruleId}
                value={confirmValues[ruleId] ?? ''}
                onChange={(value) =>
                  setConfirmValues((current) => ({ ...current, [ruleId]: value }))
                }
              />
            </div>
          ))}
        </div>
        <div className="flex items-center gap-[12px] border-t border-border px-[26px] py-[16px]">
          <button
            type="button"
            onClick={onCancel}
            className="cursor-pointer rounded-[8px] border border-card-line bg-card px-[18px] py-[10px] text-[13px] text-text"
          >
            Cancel
          </button>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => onConfirm(confirmRules)}
            disabled={!allConfirmed}
            className="rounded-[8px] border-none px-[20px] py-[10px] text-[13.5px] [font-weight:600]"
            style={{
              cursor: allConfirmed ? 'pointer' : 'not-allowed',
              background: allConfirmed ? 'var(--accent)' : 'var(--border)',
              color: allConfirmed ? 'var(--accent-fg)' : 'var(--text3)',
            }}
          >
            Clean {formatBytes(plan.totals.total)}
          </button>
        </div>
      </div>
    </div>
  );
}

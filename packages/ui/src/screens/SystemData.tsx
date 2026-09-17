import { useState } from 'react';
import type { SystemDataBucket, SystemDataReport, Tier } from '@diskwise/core/types';
import { CopyCommandCard } from '../components/CopyCommandCard';
import { DetailPanel } from '../components/DetailPanel';
import { EmptyState } from '../components/EmptyState';
import { TierBadge } from '../components/TierBadge';
import { systemBuckets } from '../mock/data';
import { useMock } from '../api/client';
import { formatBytes } from '../lib/format';

const TOTAL_BYTES = 78.2 * 1_000_000_000;
const BAR_REFERENCE = 39.1 * 1_000_000_000;

const UNMEASURED_ID = '__unmeasured';
const UNMEASURED_TITLE = 'Unmeasured (protected / needs root)';
const UNMEASURED_EXPLANATION =
  'Areas DiskWise couldn’t read: SIP-protected paths and folders that need root. Shown as a hatched bucket so the total always adds up honestly.';

export function SystemData({
  onNavigate,
  systemData,
  onScanAgain,
}: {
  onNavigate: (hash: string) => void;
  systemData?: SystemDataReport;
  onScanAgain: () => void;
}) {
  if (useMock) return <MockSystemData onNavigate={onNavigate} />;
  if (!systemData) return <MissingSystemData onScanAgain={onScanAgain} />;
  return <LiveSystemData systemData={systemData} />;
}

function MockSystemData({ onNavigate }: { onNavigate: (hash: string) => void }) {
  const [selectedId, setSelectedId] = useState('coresim');
  const selected = systemBuckets.find((bucket) => bucket.id === selectedId) ?? systemBuckets[0];
  const totalBytes = TOTAL_BYTES;

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex-1 overflow-y-auto px-[36px] py-[32px]">
        <div className="text-[13px] [font-weight:500] text-text2">System Data</div>
        <div className="mt-[4px] text-[26px] [font-weight:660] tracking-[-0.02em]">
          What macOS calls "System Data"
        </div>
        <div className="mt-[6px] text-[11.5px] text-text3">
          Detailed System Data breakdown arrives in v0.3. Figures below are an example.
        </div>
        <div className="mt-[4px] text-[13px] text-text2">
          {formatBytes(totalBytes)} total — decomposed into named buckets. The buckets plus
          Unmeasured always equal the total.
        </div>
        <div className="mt-[22px] flex flex-col gap-[9px]">
          {systemBuckets.map((bucket) => {
            const isSelected = bucket.id === selectedId;
            const pct = Math.min(100, (bucket.sizeBytes / BAR_REFERENCE) * 100);
            return (
              <button
                key={bucket.id}
                type="button"
                onClick={() => setSelectedId(bucket.id)}
                className="cursor-pointer rounded-[10px] border bg-card px-[16px] py-[14px] text-left"
                style={{ borderColor: isSelected ? 'var(--sel-line)' : 'var(--card-line)' }}
              >
                <div className="flex items-center gap-[12px]">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] [font-weight:550]">{bucket.name}</div>
                    <div className="mt-[2px] text-[11.5px] text-text3">{bucket.note}</div>
                  </div>
                  <div className="font-mono text-[13.5px] [font-weight:600]">
                    {bucket.sizeLabel}
                  </div>
                  <TierBadge tier={bucket.tier} />
                </div>
                <div className="mt-[11px] h-[6px] rounded-[3px] bg-border2">
                  <div
                    className="h-full rounded-[3px]"
                    style={{ width: `${pct}%`, background: `var(--t${bucket.tier}-dot)` }}
                  />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <DetailPanel>
        {selected ? (
          <div>
            <TierBadge tier={selected.tier} />
            <div className="mt-[12px] mb-[2px] text-[16px] [font-weight:640] tracking-[-0.01em]">
              {selected.name}
            </div>
            <div className="font-mono text-[12px] text-text2">{selected.path}</div>
            <div className="mt-[16px] text-[12.5px] leading-[1.55] text-text2">{selected.what}</div>
            <div className="mt-[18px] mb-[6px] text-[11px] [font-weight:600] uppercase tracking-[0.05em] text-text3">
              Safe to reclaim?
            </div>
            <div className="text-[12.5px] leading-[1.55] text-text">{selected.safe}</div>
            {selected.command ? <CopyCommandCard command={selected.command} /> : null}
            {selected.reviewable ? (
              <button
                type="button"
                onClick={() => onNavigate('#/cleanup')}
                className="mt-[18px] w-full cursor-pointer rounded-[7px] border-none bg-accent py-[9px] text-[13px] [font-weight:550] text-accent-fg"
              >
                Review in Cleanup
              </button>
            ) : null}
          </div>
        ) : null}
      </DetailPanel>
    </div>
  );
}

interface LiveRow {
  id: string;
  title: string;
  path?: string;
  bytes: number;
  tier: Tier | 'mixed';
  explanation: string;
  manualCommand?: string;
  children?: SystemDataBucket[];
  hatched?: boolean;
}

function barColor(tier: Tier | 'mixed'): string {
  return tier === 'mixed' ? 'var(--text3)' : `var(--t${tier}-dot)`;
}

function BucketBadge({ tier }: { tier: Tier | 'mixed' }) {
  if (tier === 'mixed') {
    return (
      <span className="inline-flex whitespace-nowrap rounded-[5px] border border-card-line bg-border2 px-[8px] py-[2px] text-[10.5px] [font-weight:600] text-text2">
        Mixed
      </span>
    );
  }
  return <TierBadge tier={tier} />;
}

function liveRows(systemData: SystemDataReport): LiveRow[] {
  return [
    ...systemData.buckets,
    {
      id: UNMEASURED_ID,
      title: UNMEASURED_TITLE,
      bytes: systemData.unmeasured,
      tier: 'mixed' as const,
      explanation: UNMEASURED_EXPLANATION,
      hatched: true,
    },
  ];
}

function LiveSystemData({ systemData }: { systemData: SystemDataReport }) {
  const rows = liveRows(systemData);
  const [selectedId, setSelectedId] = useState(rows[0]?.id ?? UNMEASURED_ID);
  const selected = rows.find((row) => row.id === selectedId) ?? rows[0];

  const measured = systemData.buckets.reduce((sum, bucket) => sum + bucket.bytes, 0);
  const total = systemData.total > 0 ? systemData.total : measured + systemData.unmeasured;

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex-1 overflow-y-auto px-[36px] py-[32px]">
        <div className="text-[13px] [font-weight:500] text-text2">System Data</div>
        <div className="mt-[4px] text-[26px] [font-weight:660] tracking-[-0.02em]">
          What macOS calls "System Data"
        </div>
        <div className="mt-[4px] text-[13px] text-text2">
          {formatBytes(total)} total — decomposed into named buckets. The buckets plus Unmeasured
          always equal the total.
        </div>

        <div className="mt-[16px] flex h-[10px] w-full overflow-hidden rounded-[5px] bg-border2">
          {rows.map((row) => {
            if (row.bytes <= 0 || total <= 0) return null;
            return (
              <div
                key={row.id}
                style={{
                  width: `${(row.bytes / total) * 100}%`,
                  background: row.hatched ? undefined : barColor(row.tier),
                  backgroundImage: row.hatched
                    ? 'repeating-linear-gradient(45deg, var(--border) 0 3px, transparent 3px 6px)'
                    : undefined,
                }}
              />
            );
          })}
        </div>

        <div className="mt-[22px] flex flex-col gap-[9px]">
          {rows.map((row) => (
            <LiveBucketRow
              key={row.id}
              row={row}
              selected={row.id === selectedId}
              onSelect={() => setSelectedId(row.id)}
            />
          ))}
        </div>
      </div>

      <DetailPanel>
        {selected ? (
          <div>
            <BucketBadge tier={selected.tier} />
            <div className="mt-[12px] mb-[2px] text-[16px] [font-weight:640] tracking-[-0.01em]">
              {selected.title}
            </div>
            {selected.path ? (
              <div className="font-mono text-[12px] text-text2">{selected.path}</div>
            ) : null}
            <div className="mt-[16px] text-[12.5px] leading-[1.55] text-text2">
              {selected.explanation}
            </div>
            {selected.manualCommand ? (
              <CopyCommandCard command={selected.manualCommand} />
            ) : null}
          </div>
        ) : null}
      </DetailPanel>
    </div>
  );
}

function LiveBucketRow({
  row,
  selected,
  onSelect,
}: {
  row: LiveRow;
  selected: boolean;
  onSelect: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const children = row.children ?? [];

  return (
    <div
      className="rounded-[10px] border bg-card px-[16px] py-[14px]"
      style={{ borderColor: selected ? 'var(--sel-line)' : 'var(--card-line)' }}
    >
      <button
        type="button"
        onClick={onSelect}
        className="w-full cursor-pointer border-none bg-transparent p-0 text-left"
      >
        <div className="flex items-center gap-[12px]">
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] [font-weight:550]">{row.title}</div>
            <div className="mt-[2px] text-[11.5px] text-text3">{row.explanation}</div>
          </div>
          <div className="font-mono text-[13.5px] [font-weight:600]">{formatBytes(row.bytes)}</div>
          <BucketBadge tier={row.tier} />
        </div>
      </button>

      {children.length > 0 ? (
        <div className="mt-[8px]">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="cursor-pointer border-none bg-transparent p-0 text-[11.5px] text-accent"
          >
            {expanded ? 'Hide items' : `Show ${children.length} items`}
          </button>
          {expanded ? (
            <div className="mt-[8px] flex flex-col gap-[6px]">
              {children.map((child) => (
                <div
                  key={child.id}
                  className="flex items-center gap-[10px] rounded-[7px] bg-win px-[12px] py-[8px]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px]">{child.title}</div>
                    <div className="mt-[2px] text-[11px] text-text3">{child.explanation}</div>
                  </div>
                  <div className="font-mono text-[12px] text-text2">
                    {formatBytes(child.bytes)}
                  </div>
                  <BucketBadge tier={child.tier} />
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {row.manualCommand ? <CopyCommandCard command={row.manualCommand} /> : null}
    </div>
  );
}

function MissingSystemData({ onScanAgain }: { onScanAgain: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-[16px]">
      <EmptyState message="System Data breakdown wasn't included in this scan." />
      <button
        type="button"
        onClick={onScanAgain}
        className="cursor-pointer rounded-[7px] border-none bg-accent px-[16px] py-[8px] text-[12.5px] [font-weight:550] text-accent-fg"
      >
        Scan again
      </button>
    </div>
  );
}

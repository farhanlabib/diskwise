import type { CSSProperties } from 'react';
import type { DiskSegment } from '../mock/types';
import { formatBytes } from '../lib/format';

const HATCH =
  'repeating-linear-gradient(45deg, var(--text3) 0, var(--text3) 1.5px, transparent 1.5px, transparent 6px)';

function segmentBackground(segment: DiskSegment): string {
  if (segment.hatch) return HATCH;
  return `var(--${segment.color ?? 'seg-free'})`;
}

export function SegmentedBar({
  segments,
  showLegend = true,
}: {
  segments: DiskSegment[];
  showLegend?: boolean;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.sizeGb, 0);

  return (
    <div>
      <div className="flex h-[26px] gap-[2px] overflow-hidden rounded-[6px]">
        {segments.map((segment) => (
          <div
            key={segment.id}
            title={`${segment.label} — ${formatBytes(segment.sizeGb * 1_000_000_000)}`}
            style={{
              width: `${(segment.sizeGb / total) * 100}%`,
              minWidth: '3px',
              background: segmentBackground(segment),
            }}
          />
        ))}
      </div>
      {showLegend ? (
        <div className="mt-[14px] flex flex-wrap gap-[14px_20px]">
          {segments.map((segment) => {
            const dot: CSSProperties = {
              width: '11px',
              height: '11px',
              borderRadius: '3px',
              flex: 'none',
              background: segmentBackground(segment),
              border: segment.hatch ? '1px solid var(--border)' : 'none',
            };
            return (
              <div key={segment.id} className="flex items-center gap-[7px] text-[12px]">
                <span style={dot} />
                <span className="text-text2">{segment.label}</span>
                <span className="font-mono text-text">
                  {formatBytes(segment.sizeGb * 1_000_000_000)}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

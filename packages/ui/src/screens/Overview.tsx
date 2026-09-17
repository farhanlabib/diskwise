import { SegmentedBar } from '../components/SegmentedBar';
import { TierBadge } from '../components/TierBadge';
import { TrapCard } from '../components/TrapCard';
import { disk as mockDisk, largestWins, segments as mockSegments, traps as mockTraps } from '../mock/data';
import { useMock } from '../api/client';
import { useScan } from '../api/hooks';
import { overviewFromAudit } from '../lib/derive';
import { formatBytes } from '../lib/format';

function trapTitle(path: string): string {
  const segment = path.split('/').filter(Boolean).pop() ?? path;
  return `${segment} isn't the problem`;
}

export function Overview({ onNavigate }: { onNavigate: (hash: string) => void }) {
  const { audit } = useScan();

  if (!audit) return null;

  const data = overviewFromAudit(audit);
  const disk = data.disk ?? mockDisk;
  const segments = useMock ? mockSegments : data.segments;
  const wins = useMock ? largestWins : data.largest;
  const traps = useMock ? mockTraps : data.traps;

  return (
    <div className="flex-1 overflow-y-auto px-[36px] py-[32px]">
      <div className="text-[13px] [font-weight:500] text-text2">Overview</div>
      <div className="mt-[6px] flex items-baseline gap-[14px]">
        <div className="text-[40px] [font-weight:680] tracking-[-0.02em]">
          {formatBytes(data.reclaimable)}
        </div>
        <div className="text-[17px] [font-weight:500] text-text2">reclaimable</div>
      </div>
      <div className="mt-[4px] text-[13px] text-text2">
        {formatBytes(data.byTier[0])} regenerates · {formatBytes(data.byTier[1])} re-download ·{' '}
        {formatBytes(data.byTier[2])} your data
      </div>

      <div className="mt-[26px] rounded-[10px] border border-card-line bg-card p-[18px]">
        <div className="mb-[10px] flex justify-between text-[12px] text-text2">
          <span className="[font-weight:600] text-text">
            {disk.volumeName} — {formatBytes(disk.containerTotal)}
          </span>
          <span className="font-mono">
            {formatBytes(disk.containerUsed)} used · {formatBytes(disk.containerFree)} free
          </span>
        </div>
        <SegmentedBar segments={segments} />
      </div>

      <div className="mt-[22px] grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-[18px]">
        <div>
          <div className="mb-[10px] text-[14px] [font-weight:600]">Largest wins</div>
          <div className="flex flex-col gap-[8px]">
            {wins.map((win) => (
              <button
                key={win.ruleId}
                type="button"
                onClick={() => onNavigate('#/cleanup')}
                className="flex cursor-pointer items-center gap-[12px] rounded-[9px] border border-card-line bg-card px-[15px] py-[13px] text-left hover:border-sel-line"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] [font-weight:550] tracking-[-0.01em]">
                    {win.title}
                  </div>
                  <div className="mt-[2px] text-[11.5px] text-text3">{win.detail}</div>
                </div>
                <div className="min-w-[64px] text-right font-mono text-[14px] [font-weight:600]">
                  {formatBytes(win.sizeBytes)}
                </div>
                <TierBadge tier={win.tier} />
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-[10px] text-[14px] [font-weight:600]">Good news</div>
          {traps.map((trap) => (
            <TrapCard key={trap.path} title={trapTitle(trap.path)}>
              Finder shows <span className="font-mono">{formatBytes(trap.apparent)}</span>, but it's
              a sparse file — only{' '}
              <span className="font-mono text-text">{formatBytes(trap.allocated)}</span> is
              actually allocated on disk. Nothing to do here.
            </TrapCard>
          ))}
          <TrapCard tone="neutral">
            Numbers we couldn't read (protected or need root) are shown as{' '}
            <span className="[font-weight:600] text-text">Unmeasured</span>, never hidden.
          </TrapCard>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { scanBuckets } from '../mock/data';
import { useMock } from '../api/client';
import { useScan } from '../api/hooks';
import { formatCount, middleTruncate } from '../lib/format';

const PATHS = [
  '~/Library/Developer/CoreSimulator/Devices/3F2A1C8E/data/Containers',
  '~/Library/Caches/com.tinyspeck.slackmacgap/Service Worker',
  '~/Library/Application Support/Google/Chrome/OptGuideOnDeviceModel',
  '/private/var/db',
  '~/Library/Containers/com.microsoft.teams2/Data',
];

function spinnerStyle() {
  return { borderTopColor: 'var(--accent)', animation: 'spin 0.8s linear infinite' };
}

function MockScanning({ onNavigate }: { onNavigate: (hash: string) => void }) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 220);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => onNavigate('#/overview'), 3500);
    return () => window.clearTimeout(timer);
  }, [onNavigate]);

  const entries = 418_204 + tick * 2_134;
  const elapsed = 8.3 + tick * 0.22;
  const path = PATHS[tick % PATHS.length] ?? PATHS[0] ?? '';
  const doneCount = Math.min(scanBuckets.length, Math.floor(tick / 3) + 2);

  return (
    <ScanLayout path={path} entries={entries} elapsed={elapsed} onCancel={() => onNavigate('#/overview')}>
      {scanBuckets.map((bucket, index) => {
        const state = index < doneCount ? 'done' : index === doneCount ? 'scanning' : 'queued';
        return <BucketRow key={bucket.id} label={bucket.label} state={state} value={state === 'done' ? bucket.sizeLabel : state === 'scanning' ? '—' : ''} />;
      })}
    </ScanLayout>
  );
}

function LiveScanning({ onNavigate }: { onNavigate: (hash: string) => void }) {
  const { state, progress, error, start, cancel } = useScan();
  const startedAt = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (state === 'idle') {
      start();
    }
  }, [state, start]);

  useEffect(() => {
    if (state === 'done') onNavigate('#/overview');
  }, [state, onNavigate]);

  useEffect(() => {
    if (state !== 'running') {
      startedAt.current = null;
      setElapsed(0);
      return undefined;
    }
    startedAt.current = Date.now();
    const timer = window.setInterval(() => {
      setElapsed((Date.now() - (startedAt.current ?? Date.now())) / 1000);
    }, 220);
    return () => window.clearInterval(timer);
  }, [state]);

  if (state === 'failed' || state === 'cancelled') {
    return (
      <div className="flex flex-1 items-center justify-center bg-content p-[40px]">
        <div className="w-full max-w-[520px]">
          <div className="text-[20px] [font-weight:640]">
            {state === 'cancelled' ? 'Scan cancelled' : 'Scan failed'}
          </div>
          {error ? <div className="mt-[8px] font-mono text-[12px] text-text3">{error}</div> : null}
          <div className="mt-[22px] flex gap-[10px]">
            <button
              type="button"
              onClick={start}
              className="cursor-pointer rounded-[7px] border-none bg-accent px-[16px] py-[8px] text-[12.5px] text-accent-fg"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => onNavigate('#/overview')}
              className="cursor-pointer rounded-[7px] border border-card-line bg-card px-[16px] py-[8px] text-[12.5px] text-text2"
            >
              Back to Overview
            </button>
          </div>
        </div>
      </div>
    );
  }

  const entries = progress?.entries ?? 0;
  const path = progress?.path ?? '';

  return (
    <ScanLayout
      path={path}
      entries={entries}
      elapsed={elapsed}
      onCancel={() => {
        cancel();
        onNavigate('#/overview');
      }}
    >
      {scanBuckets.map((bucket, index) => (
        <BucketRow
          key={bucket.id}
          label={bucket.label}
          state={index === 0 ? 'scanning' : 'queued'}
          value={index === 0 ? '—' : ''}
        />
      ))}
    </ScanLayout>
  );
}

function ScanLayout({
  path,
  entries,
  elapsed,
  onCancel,
  children,
}: {
  path: string;
  entries: number;
  elapsed: number;
  onCancel: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-1 items-center justify-center bg-content p-[40px]">
      <div className="w-full max-w-[520px]">
        <div className="flex items-center gap-[14px]">
          <div className="h-[22px] w-[22px] rounded-full border-[2.5px] border-border" style={spinnerStyle()} />
          <div className="text-[20px] [font-weight:640]">Scanning…</div>
        </div>
        <div className="mt-[16px] truncate font-mono text-[12px] text-text3">
          {middleTruncate(path || 'Starting…', 62)}
        </div>
        <div className="mt-[8px] flex gap-[24px] text-[12px] text-text2">
          <span>{formatCount(entries)} entries</span>
          <span>{elapsed.toFixed(1)} s elapsed</span>
        </div>
        <div className="mt-[22px] flex flex-col gap-[6px]">{children}</div>
        <button
          type="button"
          onClick={onCancel}
          className="mt-[22px] cursor-pointer rounded-[7px] border border-card-line bg-card px-[16px] py-[8px] text-[12.5px] text-text2"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function BucketRow({
  label,
  state,
  value,
}: {
  label: string;
  state: 'done' | 'scanning' | 'queued';
  value: string;
}) {
  return (
    <div
      className="flex items-center gap-[10px] rounded-[8px] border border-card-line bg-card px-[14px] py-[11px]"
      style={state === 'queued' ? { animation: 'skel 1.4s ease-in-out infinite' } : undefined}
    >
      <span className="flex-1 text-[12.5px]">{label}</span>
      <span className="font-mono text-[12px] text-text2">{value}</span>
    </div>
  );
}

export function Scanning({ onNavigate }: { onNavigate: (hash: string) => void }) {
  if (useMock) return <MockScanning onNavigate={onNavigate} />;
  return <LiveScanning onNavigate={onNavigate} />;
}

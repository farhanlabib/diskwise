import { useEffect, useState } from 'react';
import type { CleanupPlan, ItemStatus } from '@macsweep/core/types';
import { runItems as mockPlanItems } from '../mock/data';
import type { RunItem } from '../mock/types';
import { useMock } from '../api/client';
import { useExecution } from '../api/hooks';
import { formatBytes } from '../lib/format';

type DisplayStatus = 'queued' | 'running' | 'done' | 'skipped' | 'failed';

const STATUS_TEXT: Record<DisplayStatus, string> = {
  queued: 'Queued',
  running: 'Running…',
  done: 'Done',
  skipped: 'Skipped',
  failed: 'Failed',
};

const GB = 1_000_000_000;

function mapStatus(status: ItemStatus): DisplayStatus {
  if (status === 'done') return 'done';
  if (status === 'failed') return 'failed';
  return 'skipped';
}

function MockRunning({ onNavigate }: { onNavigate: (hash: string) => void }) {
  const items: RunItem[] = mockPlanItems;
  const plannedBytes = 21.3 * GB;
  const freedBytes = 20.8 * GB;
  const [step, setStep] = useState(0);
  const finished = step >= items.length;

  useEffect(() => {
    if (finished) return;
    const timer = window.setInterval(() => {
      setStep((current) => Math.min(current + 1, items.length));
    }, 700);
    return () => window.clearInterval(timer);
  }, [finished, items.length]);

  const statusOf = (index: number): DisplayStatus => {
    if (index < step) return 'done';
    if (index === step) return 'running';
    return 'queued';
  };

  if (finished) {
    return (
      <div className="flex flex-1 flex-col items-center overflow-y-auto p-[36px]">
        <div className="w-full max-w-[560px]">
          <div className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-t0-soft text-[26px] text-t0-fg">
            ✓
          </div>
          <div className="mt-[16px] text-[28px] [font-weight:660] tracking-[-0.02em]">
            Freed {formatBytes(freedBytes)}
          </div>
          <div className="mt-[4px] text-[13.5px] text-text2">
            Planned {formatBytes(plannedBytes)}. Docker.raw shrinks gradually, so the last 0.5 GB
            will free up over the next few minutes.
          </div>
          <div className="mt-[24px] flex flex-col gap-[8px]">
            {items.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-[12px] rounded-[8px] border border-card-line bg-card px-[15px] py-[12px]"
              >
                <span className="text-[14px]" style={{ color: 'var(--t0-dot)' }}>
                  ✓
                </span>
                <div className="flex-1 text-[13px] [font-weight:550]">{item.title}</div>
                <div className="font-mono text-[12.5px] text-text2">
                  {formatBytes(item.freedBytes)}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-[24px] flex gap-[12px]">
            <button
              type="button"
              onClick={() => onNavigate('#/history')}
              className="cursor-pointer rounded-[8px] border-none bg-accent px-[18px] py-[10px] text-[13px] [font-weight:550] text-accent-fg"
            >
              View in History
            </button>
            <button
              type="button"
              className="cursor-pointer rounded-[8px] border border-card-line bg-card px-[18px] py-[10px] text-[13px] [font-weight:550] text-text"
            >
              Undo trash moves
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center overflow-y-auto p-[36px]">
      <div className="w-full max-w-[560px]">
        <div className="text-[22px] [font-weight:640] tracking-[-0.02em]">Cleaning…</div>
        <div className="mt-[4px] text-[13px] text-text2">
          {Math.min(step, items.length)} of {items.length} done
        </div>
        <div className="mt-[22px] flex flex-col gap-[8px]">
          {items.map((item, index) => {
            const status = statusOf(index);
            return (
              <div
                key={item.id}
                className="flex items-center gap-[12px] rounded-[8px] border border-card-line bg-card px-[15px] py-[12px]"
              >
                <StatusIcon status={status} />
                <div className="flex-1">
                  <div className="text-[13px] [font-weight:550]">{item.title}</div>
                  <div className="text-[11.5px] text-text3">{STATUS_TEXT[status]}</div>
                </div>
                <div className="font-mono text-[12.5px] text-text2">
                  {formatBytes(item.sizeBytes)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function LiveRunning({ plan, onNavigate }: { plan: CleanupPlan; onNavigate: (hash: string) => void }) {
  const { state, results, result, error } = useExecution();
  const resultsById = new Map(results.map((entry) => [entry.itemId, entry]));
  const firstPending = plan.items.findIndex((item) => !resultsById.has(item.id));
  const freed = result?.freed ?? results.reduce((sum, entry) => sum + entry.freed, 0);

  if (state === 'failed') {
    return (
      <div className="flex flex-1 flex-col items-center overflow-y-auto p-[36px]">
        <div className="w-full max-w-[560px]">
          <div className="text-[22px] [font-weight:640] tracking-[-0.02em]">Cleanup failed</div>
          {error ? <div className="mt-[8px] font-mono text-[12px] text-text3">{error}</div> : null}
          <button
            type="button"
            onClick={() => onNavigate('#/cleanup')}
            className="mt-[20px] cursor-pointer rounded-[8px] border border-card-line bg-card px-[18px] py-[10px] text-[13px] text-text"
          >
            Back to Cleanup
          </button>
        </div>
      </div>
    );
  }

  if (state === 'done') {
    return (
      <div className="flex flex-1 flex-col items-center overflow-y-auto p-[36px]">
        <div className="w-full max-w-[560px]">
          <div className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-t0-soft text-[26px] text-t0-fg">
            ✓
          </div>
          <div className="mt-[16px] text-[28px] [font-weight:660] tracking-[-0.02em]">
            Freed {formatBytes(freed)}
          </div>
          <div className="mt-[4px] text-[13.5px] text-text2">
            Planned {formatBytes(plan.totals.total)}. Some space frees up gradually — sparse files
            shrink over the next few minutes.
          </div>
          <div className="mt-[24px] flex flex-col gap-[8px]">
            {results.map((entry) => (
              <div
                key={entry.itemId}
                className="flex items-center gap-[12px] rounded-[8px] border border-card-line bg-card px-[15px] py-[12px]"
              >
                <span className="text-[14px]" style={{ color: 'var(--t0-dot)' }}>
                  ✓
                </span>
                <div className="flex-1 text-[13px] [font-weight:550]">
                  {entry.path ?? entry.ruleId}
                </div>
                <div className="font-mono text-[12.5px] text-text2">
                  {formatBytes(entry.freed)}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-[24px] flex gap-[12px]">
            <button
              type="button"
              onClick={() => onNavigate('#/history')}
              className="cursor-pointer rounded-[8px] border-none bg-accent px-[18px] py-[10px] text-[13px] [font-weight:550] text-accent-fg"
            >
              View in History
            </button>
            <button
              type="button"
              onClick={() => onNavigate('#/history')}
              className="cursor-pointer rounded-[8px] border border-card-line bg-card px-[18px] py-[10px] text-[13px] [font-weight:550] text-text"
            >
              Undo trash moves
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center overflow-y-auto p-[36px]">
      <div className="w-full max-w-[560px]">
        <div className="text-[22px] [font-weight:640] tracking-[-0.02em]">Cleaning…</div>
        <div className="mt-[4px] text-[13px] text-text2">
          {results.length} of {plan.items.length} done
        </div>
        <div className="mt-[22px] flex flex-col gap-[8px]">
          {plan.items.map((item, index) => {
            const entry = resultsById.get(item.id);
            const status: DisplayStatus = entry
              ? mapStatus(entry.status)
              : index === firstPending
                ? 'running'
                : 'queued';
            return (
              <div
                key={item.id}
                className="flex items-center gap-[12px] rounded-[8px] border border-card-line bg-card px-[15px] py-[12px]"
              >
                <StatusIcon status={status} />
                <div className="flex-1">
                  <div className="text-[13px] [font-weight:550]">{item.title}</div>
                  <div className="text-[11.5px] text-text3">
                    {STATUS_TEXT[status]}
                    {entry?.reason ? ` — ${entry.reason}` : ''}
                  </div>
                </div>
                <div className="font-mono text-[12.5px] text-text2">
                  {formatBytes(entry?.bytesBefore ?? item.match.bytesAllocated)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function Running({
  plan,
  onNavigate,
}: {
  plan?: CleanupPlan | null;
  onNavigate: (hash: string) => void;
}) {
  if (useMock) return <MockRunning onNavigate={onNavigate} />;
  if (!plan) {
    return (
      <div className="flex flex-1 flex-col items-center overflow-y-auto p-[36px]">
        <div className="w-full max-w-[560px]">
          <div className="text-[22px] [font-weight:640] tracking-[-0.02em]">No run in progress</div>
          <button
            type="button"
            onClick={() => onNavigate('#/overview')}
            className="mt-[20px] cursor-pointer rounded-[8px] border border-card-line bg-card px-[18px] py-[10px] text-[13px] text-text"
          >
            Back to Overview
          </button>
        </div>
      </div>
    );
  }
  return <LiveRunning plan={plan} onNavigate={onNavigate} />;
}

function StatusIcon({ status }: { status: DisplayStatus }) {
  if (status === 'done') {
    return (
      <span className="text-[14px]" style={{ color: 'var(--t0-dot)' }}>
        ✓
      </span>
    );
  }
  if (status === 'running') {
    return (
      <span
        className="h-[14px] w-[14px] rounded-full border-[2.5px] border-border"
        style={{
          borderTopColor: 'var(--accent)',
          animation: 'spin 0.8s linear infinite',
        }}
      />
    );
  }
  if (status === 'skipped') {
    return <span className="text-[13px] text-text3">–</span>;
  }
  if (status === 'failed') {
    return <span className="text-[13px] text-t2-fg">!</span>;
  }
  return <span className="text-[13px] text-text3">·</span>;
}

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import type { UndoItemResult } from '@diskwise/core/types';
import { history as mockHistory } from '../mock/data';
import type { HistoryRun } from '../mock/types';
import { formatBytes } from '../lib/format';
import { useMock } from '../api/client';
import { describeError, undo, useRuns, type DescribedError } from '../api/hooks';
import { ErrorNote } from '../components/ErrorNote';
import { historyFromRuns } from '../lib/derive';

interface RunAction {
  title: string;
  beforeBytes: number;
  afterBytes: number;
  restorable: boolean;
  reason?: string;
}

const GB = 1_000_000_000;

const RUN_ACTIONS: Record<string, RunAction[]> = {
  'run-today': [
    { title: 'Xcode DerivedData', beforeBytes: 8.4 * GB, afterBytes: 0, restorable: false, reason: 'Rebuilds automatically, nothing to restore' },
    { title: 'iOS 26.1 simulator runtime', beforeBytes: 16 * GB, afterBytes: 0, restorable: false, reason: 'Rebuilds automatically, nothing to restore' },
    { title: 'Homebrew download cache', beforeBytes: 1.9 * GB, afterBytes: 0, restorable: false, reason: 'Rebuilds automatically, nothing to restore' },
    { title: 'node_modules (41 projects)', beforeBytes: 7.2 * GB, afterBytes: 0.1 * GB, restorable: false, reason: 'Rebuilds automatically, nothing to restore' },
    { title: 'iOS device backups', beforeBytes: 1.4 * GB, afterBytes: 0, restorable: true },
  ],
  'run-sep12': [
    { title: 'Xcode DerivedData', beforeBytes: 8.4 * GB, afterBytes: 0, restorable: false, reason: 'Rebuilds automatically, nothing to restore' },
    { title: 'Homebrew download cache', beforeBytes: 1.9 * GB, afterBytes: 0, restorable: false, reason: 'Rebuilds automatically, nothing to restore' },
    { title: 'node_modules (9 projects)', beforeBytes: 0.9 * GB, afterBytes: 0, restorable: false, reason: 'Rebuilds automatically, nothing to restore' },
  ],
  'run-sep4': [
    { title: 'iOS device backups', beforeBytes: 12.6 * GB, afterBytes: 0, restorable: false, reason: 'Trash was emptied' },
    { title: 'Docker build cache', beforeBytes: 6.2 * GB, afterBytes: 0, restorable: false, reason: 'Rebuilds automatically, nothing to restore' },
    { title: 'Chrome profiles', beforeBytes: 9.8 * GB, afterBytes: 0, restorable: false, reason: 'Trash was emptied' },
    { title: 'node_modules (22 projects)', beforeBytes: 4 * GB, afterBytes: 0, restorable: false, reason: 'Rebuilds automatically, nothing to restore' },
  ],
};

const UNDO_LABEL: Record<UndoItemResult['status'], string> = {
  restored: 'Restored',
  'not-restorable': 'Not restorable',
  'missing-from-trash': 'Missing from Trash',
  'destination-exists': 'Destination exists',
  'unknown-outcome': 'Outcome unknown',
  failed: 'Failed',
};

function MockHistory() {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <HistoryShell>
      {mockHistory.map((run) => {
        const expanded = expandedId === run.id;
        const actions = RUN_ACTIONS[run.id] ?? [];
        return (
          <div key={run.id} className="rounded-[10px] border border-card-line bg-card px-[18px] py-[16px]">
            <div className="flex items-center gap-[12px]">
              <button
                type="button"
                onClick={() => setExpandedId((current) => (current === run.id ? null : run.id))}
                className="flex-1 cursor-pointer border-none bg-transparent p-0 text-left"
              >
                <div className="text-[14px] [font-weight:600]">{run.date}</div>
                <div className="mt-[2px] text-[12px] text-text3">
                  {run.items} items · {formatBytes(run.freedBytes)} freed
                </div>
              </button>
              {run.undoable ? (
                <button
                  type="button"
                  className="cursor-pointer rounded-[6px] border border-card-line bg-transparent px-[12px] py-[6px] text-[12px] text-accent"
                >
                  Undo
                </button>
              ) : (
                <span className="text-[11.5px] text-text3">{run.reason}</span>
              )}
            </div>
            {expanded ? (
              <div className="mt-[14px] border-t border-border2 pt-[10px]">
                {actions.map((action) => (
                  <div key={action.title} className="flex items-center gap-[12px] py-[7px]">
                    <div className="flex-1">
                      <div className="text-[12.5px] [font-weight:550]">{action.title}</div>
                      {action.reason ? (
                        <div className="mt-[1px] text-[11px] text-text3">{action.reason}</div>
                      ) : null}
                    </div>
                    <div className="font-mono text-[11.5px] text-text2">
                      {formatBytes(action.beforeBytes)} → {formatBytes(action.afterBytes)}
                    </div>
                    {action.restorable ? (
                      <button
                        type="button"
                        className="cursor-pointer rounded-[6px] border border-card-line bg-transparent px-[10px] py-[5px] text-[11.5px] text-accent"
                      >
                        Undo
                      </button>
                    ) : (
                      <span className="text-[11px] text-text3">Not restorable</span>
                    )}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </HistoryShell>
  );
}

function LiveHistory() {
  const { runs, refresh, error } = useRuns();
  const items = useMemo(() => historyFromRuns(runs), [runs]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [undoResults, setUndoResults] = useState<Record<string, UndoItemResult[]>>({});
  const [undoErrors, setUndoErrors] = useState<Record<string, DescribedError>>({});

  const onUndo = useCallback(
    (runId: string) => {
      setBusy(runId);
      setExpandedId(runId);
      setUndoErrors((current) => {
        if (!(runId in current)) return current;
        const next = { ...current };
        delete next[runId];
        return next;
      });
      undo(runId)
        .then((results) => {
          setUndoResults((current) => ({ ...current, [runId]: results }));
          refresh();
        })
        .catch((err) => {
          setUndoErrors((current) => ({ ...current, [runId]: describeError(err) }));
        })
        .finally(() => setBusy(null));
    },
    [refresh],
  );

  return (
    <HistoryShell>
      {error ? (
        <div className="rounded-[10px] border border-card-line bg-card px-[18px] py-[14px]">
          <ErrorNote
            message={`Couldn’t refresh the run list. ${error.message}`}
            detail={error.detail}
            hint={
              items.length > 0
                ? 'Showing runs from the last successful refresh; they may be out of date.'
                : undefined
            }
            onRetry={refresh}
          />
        </div>
      ) : null}
      {!error && items.length === 0 ? (
        <div className="text-[12.5px] text-text3">No cleanup runs yet.</div>
      ) : null}
      {items.map((run: HistoryRun) => {
        const summary = runs.find((entry) => entry.runId === run.id);
        const results = undoResults[run.id];
        const undoError = undoErrors[run.id];
        const expanded = expandedId === run.id;
        return (
          <div key={run.id} className="rounded-[10px] border border-card-line bg-card px-[18px] py-[16px]">
            <div className="flex items-center gap-[12px]">
              <button
                type="button"
                onClick={() => setExpandedId((current) => (current === run.id ? null : run.id))}
                className="flex-1 cursor-pointer border-none bg-transparent p-0 text-left"
              >
                <div className="text-[14px] [font-weight:600]">{run.date}</div>
                <div className="mt-[2px] text-[12px] text-text3">
                  {run.items} items · {formatBytes(run.freedBytes)} freed
                </div>
              </button>
              {run.undoable ? (
                <button
                  type="button"
                  onClick={() => onUndo(run.id)}
                  disabled={busy === run.id}
                  className="cursor-pointer rounded-[6px] border border-card-line bg-transparent px-[12px] py-[6px] text-[12px] text-accent"
                >
                  {busy === run.id ? 'Undoing…' : 'Undo'}
                </button>
              ) : (
                <span className="text-[11.5px] text-text3">{run.reason}</span>
              )}
            </div>
            {expanded ? (
              <div className="mt-[14px] border-t border-border2 pt-[10px]">
                <div className="py-[6px] text-[11.5px] text-text3">
                  {summary?.apply ? 'Applied' : 'Dry run'} · {summary?.restorableCount ?? 0}{' '}
                  restorable
                  {summary?.incomplete ? ' · Run incomplete' : ''}
                </div>
                {undoError ? (
                  <div className="py-[6px]">
                    <ErrorNote
                      message={`Undo failed. ${undoError.message}`}
                      detail={undoError.detail}
                      hint="Items already restored stay restored — check the list before trying again."
                    />
                  </div>
                ) : null}
                {results ? (
                  results.map((result) => (
                    <div key={result.itemId} className="flex items-center gap-[12px] py-[7px]">
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-mono text-[11.5px] text-text2">
                          {result.path ?? result.itemId}
                        </div>
                        {result.reason ? (
                          <div className="mt-[1px] text-[11px] text-text3">{result.reason}</div>
                        ) : null}
                      </div>
                      <span className="text-[11.5px] text-text2">
                        {UNDO_LABEL[result.status]}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="py-[6px] text-[11.5px] text-text3">
                    Use Undo to restore trashed items and see per-item outcomes.
                  </div>
                )}
              </div>
            ) : null}
          </div>
        );
      })}
    </HistoryShell>
  );
}

function HistoryShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex-1 overflow-y-auto px-[36px] py-[32px]">
      <div className="text-[13px] [font-weight:500] text-text2">History</div>
      <div className="mt-[2px] text-[22px] [font-weight:640] tracking-[-0.02em]">Cleanup runs</div>
      <div className="mt-[20px] flex flex-col gap-[10px]">{children}</div>
    </div>
  );
}

export function History() {
  if (useMock) return <MockHistory />;
  return <LiveHistory />;
}

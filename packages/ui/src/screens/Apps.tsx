import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppIcon } from '../components/AppIcon';
import { EmptyState } from '../components/EmptyState';
import { TierBadge } from '../components/TierBadge';
import { apps as mockApps, locationGroups } from '../mock/data';
import type { AppEntry, AppLocationGroup } from '../mock/types';
import { formatBytes } from '../lib/format';
import { useMock } from '../api/client';
import { quitApp, useAppScan } from '../api/hooks';
import { appGroupsFromReport, appsFromReports } from '../lib/derive';

const FILTERS = [
  'All',
  'Has caches to clean',
  'Running',
  'Not used in 90+ days',
  'Orphaned data',
] as const;

const GRID = 'grid-cols-[1fr_120px_90px_90px_84px]';

type SortKey = 'caches' | 'appData' | 'total' | 'name';

function lastUsedRank(app: AppEntry): number {
  if (app.lastUsed === 'unknown') return 999;
  if (app.lastUsed === 'now' || app.lastUsed === 'today') return 0;
  if (app.lastUsed === 'yesterday') return 1;
  if (app.lastUsed.includes('week')) return 7;
  return Number.parseInt(app.lastUsed, 10) || 0;
}

export function Apps({
  appId,
  onNavigate,
  onOpenReview,
}: {
  appId?: string;
  onNavigate: (hash: string) => void;
  onOpenReview: () => void;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('All');
  const [sortKey, setSortKey] = useState<SortKey>('caches');
  const [quitIds, setQuitIds] = useState<string[]>([]);
  const [highlight, setHighlight] = useState(0);

  const appScan = useAppScan();
  const reports = appScan.reports ?? [];
  const liveApps = useMemo(() => appsFromReports(reports), [reports]);
  const list = useMock ? mockApps : liveApps;
  const scanning = !useMock && appScan.state !== 'done';

  const groupsFor = useCallback(
    (app: AppEntry): AppLocationGroup[] => {
      if (useMock) return locationGroups(app);
      const report = reports.find((entry) => entry.app.bundleId === app.bundleId);
      return report ? appGroupsFromReport(report) : [];
    },
    [reports],
  );

  const isRunning = (app: AppEntry) => app.running && !quitIds.includes(app.id);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = list.filter((app) => {
      if (q && !app.name.toLowerCase().includes(q) && !app.bundleId.toLowerCase().includes(q)) {
        return false;
      }
      if (filter === 'Has caches to clean') return app.cachesBytes > 50_000_000;
      if (filter === 'Running') return app.running && !quitIds.includes(app.id);
      if (filter === 'Not used in 90+ days') return lastUsedRank(app) >= 90;
      if (filter === 'Orphaned data') return app.orphan;
      return true;
    });
    return [...filtered].sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name);
      const key =
        sortKey === 'caches' ? 'cachesBytes' : sortKey === 'appData' ? 'appDataBytes' : 'totalBytes';
      return b[key] - a[key];
    });
  }, [list, query, filter, sortKey, quitIds]);

  useEffect(() => {
    if (appId) return;
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setHighlight((current) => Math.min(current + 1, visible.length - 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setHighlight((current) => Math.max(current - 1, 0));
      } else if (event.key === 'Enter') {
        const app = visible[highlight];
        if (app) onNavigate(`#/apps/${app.bundleId}`);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [appId, visible, highlight, onNavigate]);

  const selectedApp = appId ? list.find((app) => app.bundleId === appId) : undefined;

  if (appId) {
    if (!selectedApp) {
      return (
        <div className="flex-1 overflow-y-auto px-[36px] py-[32px]">
          <EmptyState
            message={scanning ? 'Scanning apps…' : 'No app with that bundle id.'}
            hint={
              scanning
                ? 'The app list arrives as soon as the scan finishes.'
                : 'It may have been uninstalled since the last scan.'
            }
          />
          <button
            type="button"
            onClick={() => onNavigate('#/apps')}
            className="cursor-pointer border-none bg-transparent text-[12.5px] text-accent"
          >
            ‹ Apps
          </button>
        </div>
      );
    }

    const running = isRunning(selectedApp) && !selectedApp.orphan;
    const groups = groupsFor(selectedApp);
    const cleanable = groups.filter((group) => group.action === 'clean');
    const cleanBytes = cleanable.reduce((sum, group) => sum + group.sizeBytes, 0);

    return (
      <div className="flex-1 overflow-y-auto p-0">
        <div className="flex items-center gap-[8px] border-b border-border px-[36px] py-[20px]">
          <button
            type="button"
            onClick={() => onNavigate('#/apps')}
            className="cursor-pointer border-none bg-transparent p-0 text-[12.5px] text-accent"
          >
            ‹ Apps
          </button>
        </div>
        <div className="px-[36px] py-[28px]">
          <div className="flex items-center gap-[18px]">
            <AppIcon
              name={selectedApp.name}
              color={selectedApp.color}
              size={64}
              radius={15}
              orphan={selectedApp.orphan}
              bundleId={selectedApp.bundleId}
            />
            <div className="flex-1">
              <div className="flex items-center gap-[10px]">
                <div className="text-[22px] [font-weight:660] tracking-[-0.02em]">
                  {selectedApp.name}
                </div>
                {selectedApp.orphan ? (
                  <span className="rounded-[5px] bg-t2-soft px-[9px] py-[3px] text-[11.5px] text-t2-fg">
                    Uninstalled app
                  </span>
                ) : running ? (
                  <span className="flex items-center gap-[5px] rounded-[5px] bg-t0-soft px-[9px] py-[3px] text-[11.5px] text-t0-fg">
                    <span
                      className="h-[6px] w-[6px] rounded-full"
                      style={{ background: 'var(--t0-dot)' }}
                    />
                    Running
                  </span>
                ) : null}
              </div>
              <div className="mt-[4px] font-mono text-[12px] text-text3">
                {selectedApp.bundleId} · {selectedApp.version} · last used{' '}
                {selectedApp.lastUsed}
              </div>
            </div>
            <div className="text-right text-[11px] text-text3">
              {selectedApp.knownProfile
                ? 'Known app profile'
                : 'Generic rule (standard cache folders only)'}
            </div>
          </div>

          <div className="mt-[24px] flex flex-col gap-[12px]">
            {groups.map((group) => (
              <LocationGroupCard key={group.id} group={group} />
            ))}
          </div>

          <div className="mt-[22px] flex items-center gap-[12px]">
            {running ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setQuitIds((ids) => [...ids, selectedApp.id]);
                    if (!useMock) {
                      void quitApp(selectedApp.bundleId)
                        .then(() => appScan.start())
                        .catch(() => {});
                    }
                  }}
                  className="cursor-pointer rounded-[8px] border-none bg-accent px-[20px] py-[11px] text-[13.5px] [font-weight:600] text-accent-fg"
                >
                  Quit {selectedApp.name} to clean
                </button>
                <span className="text-[12px] text-text2">
                  Caches can't be cleaned while the app is running.
                </span>
              </>
            ) : cleanBytes > 0 ? (
              <button
                type="button"
                onClick={onOpenReview}
                className="cursor-pointer rounded-[8px] border-none bg-accent px-[20px] py-[11px] text-[13.5px] [font-weight:600] text-accent-fg"
              >
                Clean caches · {formatBytes(cleanBytes)}
              </button>
            ) : (
              <span className="text-[12px] text-text2">No cleanable caches for this app.</span>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border px-[36px] pt-[24px] pb-[14px]">
        <div className="text-[13px] [font-weight:500] text-text2">Apps</div>
        <div className="mt-[2px] text-[22px] [font-weight:640] tracking-[-0.02em]">
          Installed apps
        </div>
        <div className="mt-[12px] flex items-center gap-[8px]">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search apps"
            spellCheck={false}
            className="w-[220px] rounded-[7px] border border-card-line bg-card px-[10px] py-[6px] text-[12px] text-text outline-none"
          />
          <div className="flex flex-wrap gap-[8px]">
            {FILTERS.map((label) => {
              const active = label === filter;
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => setFilter(label)}
                  className="cursor-pointer rounded-[14px] border border-card-line px-[12px] py-[5px] text-[12px]"
                  style={{
                    background: active ? 'var(--accent)' : 'var(--card)',
                    color: active ? 'var(--accent-fg)' : 'var(--text2)',
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div
          className={`grid ${GRID} gap-[12px] border-b border-border2 px-[36px] py-[10px] text-[11px] [font-weight:600] uppercase tracking-[0.04em] text-text3`}
        >
          <SortHeader label="App" active={sortKey === 'name'} onClick={() => setSortKey('name')} />
          <span>Last used</span>
          <SortHeader
            label="Caches"
            align="right"
            active={sortKey === 'caches'}
            onClick={() => setSortKey('caches')}
          />
          <SortHeader
            label="App data"
            align="right"
            active={sortKey === 'appData'}
            onClick={() => setSortKey('appData')}
          />
          <SortHeader
            label="Total"
            align="right"
            active={sortKey === 'total'}
            onClick={() => setSortKey('total')}
          />
        </div>
        {visible.length === 0 ? (
          <EmptyState
            message={
              scanning
                ? 'Scanning apps…'
                : filter === 'Orphaned data'
                  ? 'No leftovers from uninstalled apps found.'
                  : 'No app caches over 50 MB.'
            }
            hint={scanning ? 'The list appears as soon as the scan finishes.' : undefined}
          />
        ) : (
          visible.map((app, index) => (
            <button
              key={app.id}
              type="button"
              data-testid="app-row"
              onClick={() => onNavigate(`#/apps/${app.bundleId}`)}
              className={`grid w-full ${GRID} cursor-pointer items-center gap-[12px] border-b border-border2 px-[36px] py-[11px] text-left hover:bg-hover ${
                index === highlight ? 'bg-sel' : ''
              }`}
            >
              <div className="flex min-w-0 items-center gap-[12px]">
                <AppIcon
                  name={app.name}
                  color={app.color}
                  orphan={app.orphan}
                  bundleId={app.bundleId}
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-[7px] text-[13px] [font-weight:550]">
                    {app.name}
                    {isRunning(app) ? (
                      <span
                        title="Running"
                        className="h-[7px] w-[7px] rounded-full"
                        style={{ background: 'var(--t0-dot)' }}
                      />
                    ) : null}
                    {app.orphan ? (
                      <span className="rounded-[4px] bg-t2-soft px-[6px] py-[1px] text-[10px] text-t2-fg">
                        orphaned
                      </span>
                    ) : null}
                  </div>
                  <div className="truncate font-mono text-[10.5px] text-text3">
                    {app.bundleId} · {app.version}
                  </div>
                </div>
              </div>
              <div className="text-[12px] text-text2">{app.lastUsed}</div>
              <div className="text-right font-mono text-[12.5px] [font-weight:600] text-t0-fg">
                {formatBytes(app.cachesBytes)}
              </div>
              <div className="text-right font-mono text-[12.5px] text-text2">
                {formatBytes(app.appDataBytes)}
              </div>
              <div className="text-right font-mono text-[12.5px] [font-weight:600]">
                {formatBytes(app.totalBytes)}
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function SortHeader({
  label,
  align = 'left',
  active,
  onClick,
}: {
  label: string;
  align?: 'left' | 'right';
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer border-none bg-transparent p-0 text-[11px] [font-weight:600] uppercase tracking-[0.04em] text-text3"
      style={{ textAlign: align, color: active ? 'var(--text)' : 'var(--text3)' }}
    >
      {label}
    </button>
  );
}

function LocationGroupCard({ group }: { group: AppLocationGroup }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      data-testid="app-location-group"
      className="rounded-[10px] border border-card-line bg-card px-[18px] py-[16px]"
    >
      <div className="flex items-center gap-[10px]">
        <div className="flex-1 text-[14px] [font-weight:600]">{group.name}</div>
        <TierBadge tier={group.tier} />
        <div className="min-w-[64px] text-right font-mono text-[14px] [font-weight:600]">
          {formatBytes(group.sizeBytes)}
        </div>
      </div>
      <div className="mt-[8px] text-[12.5px] leading-[1.5] text-text2">{group.note}</div>
      {group.folders ? (
        <div className="mt-[8px]">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="cursor-pointer border-none bg-transparent p-0 text-[11.5px] text-accent"
          >
            {expanded ? 'Hide folders' : `Show ${group.folders.length} folders`}
          </button>
          {expanded ? (
            <div className="mt-[6px] flex flex-col gap-[3px]">
              {group.folders.map((folder) => (
                <span key={folder} className="font-mono text-[11px] text-text3">
                  ~/Library/Application Support/{folder}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {group.noAction ? (
        <div className="mt-[8px] text-[11.5px] italic text-text3">{group.noAction}</div>
      ) : null}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CleanupPlan, Finding, Tier } from '@macsweep/core/types';
import { Sidebar, type NavItem } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { Apps } from './screens/Apps';
import { Cleanup } from './screens/Cleanup';
import { History } from './screens/History';
import { Onboarding } from './screens/Onboarding';
import { Overview } from './screens/Overview';
import { Review } from './screens/Review';
import { Running } from './screens/Running';
import { Scanning } from './screens/Scanning';
import { Session, type SessionVariant } from './screens/Session';
import { Settings } from './screens/Settings';
import { SystemData } from './screens/SystemData';
import { apps, audit as mockAudit, locationGroups } from './mock/data';
import { planFromFindings } from './mock/api';
import { getToken, useMock } from './api/client';
import {
  createAppPlan,
  createPlan,
  shutdown,
  useAppScan,
  useExecution,
  usePermissions,
  useScan,
} from './api/hooks';
import { cleanupRowsFromAudit, unmeasuredFromAudit } from './lib/derive';
import { formatBytes } from './lib/format';
import { getTheme, setTheme, subscribeTheme, type Theme } from './lib/theme';
import { useCollapsedSidebar } from './lib/useMediaQuery';

type Route =
  | { name: 'overview' }
  | { name: 'system-data' }
  | { name: 'apps'; bundleId?: string }
  | { name: 'cleanup' }
  | { name: 'history' }
  | { name: 'settings' }
  | { name: 'running' }
  | { name: 'onboarding' }
  | { name: 'scanning' }
  | { name: 'session'; variant: SessionVariant };

const OVERLAY_ROUTES = new Set(['onboarding', 'scanning', 'session']);

const DEFAULT_SELECTION: Record<string, boolean> = {
  'xcode.derived-data': true,
  'homebrew.cache': true,
  'dev.node-modules': true,
  'simulator.runtimes': true,
  'ios.backups': true,
};

function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const head = parts[0] ?? 'overview';
  const rest = parts[1];
  switch (head) {
    case 'system-data':
      return { name: 'system-data' };
    case 'apps':
      return rest ? { name: 'apps', bundleId: decodeURIComponent(rest) } : { name: 'apps' };
    case 'cleanup':
      return { name: 'cleanup' };
    case 'history':
      return { name: 'history' };
    case 'settings':
      return { name: 'settings' };
    case 'running':
      return { name: 'running' };
    case 'onboarding':
      return { name: 'onboarding' };
    case 'scanning':
      return { name: 'scanning' };
    case 'session': {
      const variant: SessionVariant =
        rest === 'invalid-link' || rest === 'reconnecting' ? rest : 'stopped';
      return { name: 'session', variant };
    }
    default:
      return { name: 'overview' };
  }
}

function useRoute(): [Route, (hash: string) => void] {
  const [hash, setHash] = useState(() => window.location.hash || '#/overview');

  useEffect(() => {
    if (!window.location.hash) window.location.hash = '#/overview';
    const onHashChange = () => setHash(window.location.hash || '#/overview');
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = useCallback((next: string) => {
    window.location.hash = next;
  }, []);

  const route = useMemo(() => parseHash(hash), [hash]);
  return [route, navigate];
}

function useTheme(): [Theme, () => void] {
  const [theme, setThemeState] = useState<Theme>(() => getTheme());
  useEffect(() => subscribeTheme(setThemeState), []);
  return [theme, () => setTheme(getTheme() === 'dark' ? 'light' : 'dark')];
}

function appReviewItems(bundleId: string): Finding[] {
  const app = apps.find((entry) => entry.bundleId === bundleId);
  if (!app) return [];
  return locationGroups(app)
    .filter((group) => group.action === 'clean')
    .map((group) => ({
      ruleId: `app.${app.id}.${group.id}`,
      title: `${app.name} — ${group.name}`,
      category: 'app' as const,
      tier: group.tier,
      rationale: group.note,
      regeneration: 'Rebuilt by the app the next time it opens.',
      action: null,
      needsRoot: false,
      permanentOnly: false,
      matches: [
        {
          kind: 'dir' as const,
          path: `~/Library/Caches/${app.bundleId}`,
          detail: group.name,
          bytesAllocated: group.sizeBytes,
          bytesApparent: group.sizeBytes,
        },
      ],
      totals: { allocated: group.sizeBytes, apparent: group.sizeBytes },
    }));
}

export function App() {
  const [route, navigate] = useRoute();
  const [theme, toggleTheme] = useTheme();
  const [selected, setSelected] = useState<Record<string, boolean>>(() =>
    useMock ? { ...DEFAULT_SELECTION } : {},
  );
  const [reviewPlan, setReviewPlan] = useState<CleanupPlan | null>(null);
  const [activePlan, setActivePlan] = useState<CleanupPlan | null>(null);
  const collapsed = useCollapsedSidebar();

  const scan = useScan();
  const appScan = useAppScan();
  const execution = useExecution();
  const permissions = usePermissions();

  const rows = useMemo(
    () => (scan.audit ? cleanupRowsFromAudit(scan.audit) : []),
    [scan.audit],
  );
  const unmeasured = scan.audit ? unmeasuredFromAudit(scan.audit) : undefined;

  const toggle = useCallback((ruleId: string) => {
    setSelected((current) => ({ ...current, [ruleId]: !current[ruleId] }));
  }, []);

  const granted = permissions?.fullDiskAccess === 'granted';
  const fdaLabel = granted ? 'Granted' : permissions?.fullDiskAccess === 'limited' ? 'Limited' : 'Unknown';

  const [bootstrapped, setBootstrapped] = useState(false);
  const invalidLink = !useMock && getToken() === null;

  useEffect(() => {
    const onUnauthorized = () => navigate('#/session/invalid-link');
    const onDisconnected = () => navigate('#/session/stopped');
    window.addEventListener('macsweep:unauthorized', onUnauthorized);
    window.addEventListener('macsweep:disconnected', onDisconnected);
    return () => {
      window.removeEventListener('macsweep:unauthorized', onUnauthorized);
      window.removeEventListener('macsweep:disconnected', onDisconnected);
    };
  }, [navigate]);

  useEffect(() => {
    if (useMock || invalidLink || bootstrapped || !permissions) return;
    setBootstrapped(true);
    if (permissions.fullDiskAccess === 'granted') {
      if (route.name === 'overview') navigate('#/scanning');
    } else if (window.localStorage.getItem('macsweep.onboarded') !== '1') {
      window.localStorage.setItem('macsweep.onboarded', '1');
      navigate('#/onboarding');
    }
  }, [invalidLink, bootstrapped, permissions, route.name, navigate]);

  useEffect(() => {
    if (route.name === 'apps') appScan.start();
  }, [route.name, appScan.start]);

  const selectedRows = rows.filter((row) => selected[row.ruleId]);
  const selectedBytes = selectedRows.reduce((sum, row) => sum + row.totals.allocated, 0);

  const navItems: NavItem[] = [
    { key: 'overview', label: 'Overview', icon: '◧', hash: '#/overview' },
    {
      key: 'system-data',
      label: 'System Data',
      icon: '▤',
      hash: '#/system-data',
      badge: useMock ? '78.2 GB' : unmeasured !== undefined ? formatBytes(unmeasured) : '',
    },
    { key: 'apps', label: 'Apps', icon: '▦', hash: '#/apps' },
    {
      key: 'cleanup',
      label: 'Cleanup',
      icon: '✓',
      hash: '#/cleanup',
      badge: selectedBytes > 0 ? formatBytes(selectedBytes) : '',
    },
    { key: 'history', label: 'History', icon: '↺', hash: '#/history' },
    { key: 'settings', label: 'Settings', icon: '⚙', hash: '#/settings' },
  ];

  const activeKey = route.name === 'apps' ? 'apps' : route.name;

  const openCleanupReview = useCallback(() => {
    const chosen = rows.filter((row) => selected[row.ruleId]);
    if (chosen.length === 0) return;
    if (useMock) {
      setReviewPlan(planFromFindings(chosen));
      return;
    }
    if (!scan.jobId) return;
    const tiers = [...new Set(chosen.map((row) => row.tier))].sort() as Tier[];
    const ruleIds = [...new Set(chosen.map((row) => row.ruleId))];
    createPlan(scan.jobId, { tiers, ruleIds })
      .then(setReviewPlan)
      .catch(() => {});
  }, [rows, selected, scan.jobId]);

  const openAppReview = useCallback(() => {
    if (route.name !== 'apps' || !route.bundleId) return;
    if (useMock) {
      setReviewPlan(planFromFindings(appReviewItems(route.bundleId)));
      return;
    }
    if (!appScan.jobId) return;
    createAppPlan(appScan.jobId, route.bundleId)
      .then(setReviewPlan)
      .catch(() => {});
  }, [route, appScan.jobId]);

  const confirmPlan = useCallback(
    (plan: CleanupPlan, confirmedRuleIds: string[]) => {
      setReviewPlan(null);
      setActivePlan(plan);
      if (!useMock) execution.run(plan.id, { apply: true, confirmedRuleIds });
      navigate('#/running');
    },
    [execution, navigate],
  );

  const stopServer = useCallback(() => {
    void (async () => {
      try {
        await shutdown();
      } catch {
        /* server may already be gone */
      }
      navigate('#/session/stopped');
    })();
  }, [navigate]);

  const forcedVariant: SessionVariant | null = invalidLink ? 'invalid-link' : null;

  const main = () => {
    if (
      !useMock &&
      (route.name === 'overview' || route.name === 'cleanup') &&
      scan.state !== 'done'
    ) {
      return <Scanning onNavigate={navigate} />;
    }
    switch (route.name) {
      case 'overview':
        return <Overview onNavigate={navigate} />;
      case 'system-data':
        return (
          <SystemData
            onNavigate={navigate}
            systemData={useMock ? mockAudit.systemData : scan.audit?.systemData}
            onScanAgain={() => {
              scan.start();
              navigate('#/scanning');
            }}
          />
        );
      case 'apps':
        return (
          <Apps
            appId={route.bundleId}
            onNavigate={navigate}
            onOpenReview={openAppReview}
          />
        );
      case 'cleanup':
        return (
          <Cleanup
            findings={rows}
            selected={selected}
            onToggle={toggle}
            onOpenReview={openCleanupReview}
          />
        );
      case 'history':
        return <History />;
      case 'settings':
        return <Settings onStopServer={stopServer} audit={useMock ? mockAudit : scan.audit} />;
      case 'running':
        return <Running plan={activePlan} onNavigate={navigate} />;
      default:
        return <Overview onNavigate={navigate} />;
    }
  };

  const overlay = () => {
    if (forcedVariant) return <Session variant={forcedVariant} onNavigate={navigate} />;
    switch (route.name) {
      case 'onboarding':
        return <Onboarding onNavigate={navigate} />;
      case 'scanning':
        return <Scanning onNavigate={navigate} />;
      case 'session':
        return <Session variant={route.variant} onNavigate={navigate} />;
      default:
        return null;
    }
  };

  const isOverlay = OVERLAY_ROUTES.has(route.name) || forcedVariant !== null;

  return (
    <div
      className="flex min-h-screen items-start justify-center bg-[#d9d9dc] p-[28px]"
      style={{ color: 'var(--text)' }}
    >
      <div className="relative flex h-[800px] max-h-[calc(100vh-56px)] w-[1280px] max-w-full flex-none flex-col overflow-hidden rounded-[11px] bg-win shadow-window">
        {isOverlay ? (
          overlay()
        ) : (
          <>
            <Toolbar
              themeLabel={theme === 'dark' ? 'Light' : 'Dark'}
              onToggleTheme={toggleTheme}
              onStopServer={stopServer}
            />
            <div className="flex min-h-0 flex-1">
              <Sidebar
                items={navItems}
                active={activeKey}
                collapsed={collapsed}
                fdaLabel={fdaLabel}
                onNavigate={navigate}
              />
              <div className="relative flex min-w-0 flex-1 flex-col bg-content">
                {main()}
              </div>
            </div>
          </>
        )}

        {reviewPlan ? (
          <Review
            plan={reviewPlan}
            onCancel={() => setReviewPlan(null)}
            onConfirm={(confirmedRuleIds) => confirmPlan(reviewPlan, confirmedRuleIds)}
          />
        ) : null}
      </div>
    </div>
  );
}

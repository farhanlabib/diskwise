import { randomUUID } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import type { ActionId, AppLocation, AppReport, CleanupPlan, PlanItem, Tier } from '../types';

const LABELS: Record<AppLocation['kind'], string> = {
  caches: 'Caches',
  logs: 'Logs',
  'saved-state': 'Saved window state',
  'sign-in-data': 'Sign-in & site data',
  'app-data': 'App data',
  settings: 'Settings',
};

// Cache and log folders are emptied but kept (some apps misbehave when they vanish);
// a saved-state bundle is removed whole and macOS recreates it.
function actionFor(location: AppLocation): ActionId | null {
  if (!location.actionable || location.tier > 1) return null;
  return location.kind === 'saved-state' ? 'remove-path' : 'remove-dir-contents';
}

export async function buildAppPlan(
  report: AppReport,
  opts: { id?: string; now?: Date; includeOrphanData?: boolean } = {},
): Promise<CleanupPlan> {
  const { app } = report;
  const orphaned = report.orphaned === true;
  const items: PlanItem[] = [];
  const byTier: Record<Tier, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  for (const location of report.locations) {
    // Orphaned app data is otherwise tier 2 (report-only); with the opt-in it is
    // trashed as a unit and gated behind a typed confirmation.
    const orphanData =
      orphaned &&
      opts.includeOrphanData === true &&
      location.kind === 'app-data' &&
      location.tier === 2;
    const action = orphanData ? 'trash-path' : actionFor(location);
    if (!action) continue;
    let st;
    try {
      st = await lstat(location.path);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) continue;
    items.push({
      id: `app.${app.bundleId}.${location.kind}#${items.length}`,
      ruleId: orphanData ? 'app.orphaned-data' : `app.${location.kind}`,
      title: `${app.name} — ${LABELS[location.kind]}`,
      category: 'app',
      tier: location.tier,
      action,
      permanentOnly: false,
      needsConfirmation: orphanData,
      // The app is gone, so there is nothing to preflight against.
      ...(orphaned ? {} : { preflight: { apps: [{ bundleId: app.bundleId, name: app.name }] } }),
      roots: [location.path],
      match: {
        kind: st.isDirectory() ? 'dir' : 'file',
        path: location.path,
        dev: st.dev,
        ino: st.ino,
        detail: location.path,
        appBundleId: app.bundleId,
        bytesAllocated: location.bytesAllocated,
        bytesApparent: location.bytesAllocated,
      },
    });
    byTier[location.tier] += location.bytesAllocated;
  }
  return {
    schemaVersion: 1,
    id: opts.id ?? randomUUID(),
    createdAt: (opts.now ?? new Date()).toISOString(),
    auditGeneratedAt: (opts.now ?? new Date()).toISOString(),
    items,
    manual: [],
    totals: { byTier, total: items.reduce((n, i) => n + i.match.bytesAllocated, 0) },
  };
}

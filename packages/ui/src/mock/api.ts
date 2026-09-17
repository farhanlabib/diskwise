import type {
  ActionId,
  AppLocation,
  AppLocationKind,
  AppReport,
  CleanupPlan,
  Finding,
  PlanItem,
  Tier,
} from '@macsweep/core/types';
import { apps, locationGroups } from './data';

function actionFor(finding: Finding): ActionId {
  if (finding.action) return finding.action;
  return finding.tier === 2 ? 'trash-path' : 'remove-path';
}

export function planFromFindings(findings: Finding[]): CleanupPlan {
  const items: PlanItem[] = [];
  for (const finding of findings) {
    finding.matches.forEach((match, index) => {
      items.push({
        id: `${finding.ruleId}#${index}`,
        ruleId: finding.ruleId,
        title: finding.title,
        category: finding.category,
        tier: finding.tier,
        action: actionFor(finding),
        permanentOnly: finding.permanentOnly,
        needsConfirmation: finding.tier === 2 || finding.permanentOnly,
        roots: [],
        match,
      });
    });
  }

  const byTier: Record<Tier, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  let total = 0;
  for (const finding of findings) {
    byTier[finding.tier] += finding.totals.allocated;
    total += finding.totals.allocated;
  }

  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: `mock-plan-${now}`,
    createdAt: now,
    auditGeneratedAt: now,
    items,
    manual: [],
    totals: { byTier, total },
  };
}

const KIND: Record<string, AppLocationKind> = {
  caches: 'caches',
  logs: 'logs',
  signin: 'sign-in-data',
  appdata: 'app-data',
  settings: 'settings',
};

export function appReportsForMock(): AppReport[] {
  return apps.map((app) => {
    const groups = locationGroups(app);
    const locations: AppLocation[] = groups.map((group) => ({
      kind: KIND[group.id] ?? 'app-data',
      tier: group.tier,
      actionable: group.action === 'clean',
      path: `~/Library/Application Support/${app.bundleId}`,
      bytesAllocated: group.sizeBytes,
      source: 'profile',
    }));
    const cleanable = locations
      .filter((location) => location.actionable)
      .reduce((sum, location) => sum + location.bytesAllocated, 0);
    const data = groups
      .filter((group) => group.id === 'appdata')
      .reduce((sum, group) => sum + group.sizeBytes, 0);
    return {
      app: {
        bundleId: app.bundleId,
        name: app.name,
        version: app.version.replace(/^v/, ''),
        path: `/Applications/${app.name}.app`,
        running: app.running,
        bundleBytes: Math.max(0, app.totalBytes - app.cachesBytes - app.appDataBytes),
        system: false,
      },
      locations,
      totals: { cleanable, data, all: app.totalBytes },
    };
  });
}

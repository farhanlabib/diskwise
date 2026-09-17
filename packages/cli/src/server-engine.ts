import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  allRules,
  audit,
  findOrphanedAppData,
  buildAppPlan,
  buildAppReports,
  buildPlan,
  checkFullDiskAccess,
  defaultJournalDir,
  defaultLockPath,
  executePlan,
  listInstalledApps,
  listRuns,
  native,
  openJournal,
  undoRun,
} from '@diskwise/core';
import type { ServerEngine } from '@diskwise/server';
import { VERSION } from './version';

export function createServerEngine(opts: { home?: string } = {}): ServerEngine {
  const home = opts.home ?? homedir();
  // Bundle paths from the most recent app scan: the only sources for icons.
  const appPaths = new Map<string, string>();
  const iconCache = new Map<string, Buffer>();

  return {
    audit(input) {
      return audit({
        home,
        signal: input.signal,
        onProgress: input.onProgress,
        includeSystemData: true,
      });
    },
    listRules() {
      return allRules;
    },
    buildPlan(auditResult, selection) {
      return buildPlan(auditResult, allRules, selection);
    },
    async executePlan(plan, input) {
      const journal = input.apply
        ? await openJournal({ dir: defaultJournalDir(home), lockPath: defaultLockPath(home) })
        : undefined;
      try {
        return await executePlan(plan, {
          home,
          apply: input.apply,
          confirmedRuleIds: input.confirmedRuleIds,
          signal: input.signal,
          onItem: input.onItem,
          ...(journal ? { journal } : {}),
        });
      } finally {
        await journal?.close();
      }
    },
    async listRuns() {
      return listRuns(defaultJournalDir(home));
    },
    async undoRun(runId) {
      return undoRun({ dir: defaultJournalDir(home), lockPath: defaultLockPath(home), runId });
    },
    async appReports({ signal }) {
      const perms = await checkFullDiskAccess(home);
      const apps = await listInstalledApps({ home, measureBundles: false });
      const reports = await buildAppReports({
        home,
        fullDiskAccess: perms.fullDiskAccess === 'granted',
        apps,
        signal,
      });
      const orphans = await findOrphanedAppData({
        home,
        installed: apps,
        fullDiskAccess: perms.fullDiskAccess === 'granted',
        signal,
      });
      reports.push(...orphans);
      appPaths.clear();
      iconCache.clear();
      for (const report of reports) {
        if (report.app.path) appPaths.set(report.app.bundleId, report.app.path);
      }
      return reports;
    },
    async appIcon(bundleId) {
      const cached = iconCache.get(bundleId);
      if (cached) return cached;
      const appPath = appPaths.get(bundleId);
      if (!appPath) return undefined;
      const helper = await native.findHelper();
      if (!helper) return undefined;
      const out = join(tmpdir(), `diskwise-icon-${randomUUID()}.png`);
      try {
        await new Promise<void>((resolveIcon, rejectIcon) => {
          execFile(helper, ['icon', appPath, out, '--size', '64'], (error, _stdout, stderr) => {
            if (error) rejectIcon(new Error(stderr?.trim() || error.message));
            else resolveIcon();
          });
        });
        const icon = await readFile(out);
        iconCache.set(bundleId, icon);
        return icon;
      } catch {
        return undefined;
      } finally {
        await rm(out, { force: true }).catch(() => {});
      }
    },
    buildAppPlan(report) {
      return buildAppPlan(report);
    },
    permissions() {
      return checkFullDiskAccess(home);
    },
    async quitApp(bundleId) {
      const result = await native.quitApp(bundleId);
      return { quit: result.quit };
    },
    version: VERSION,
  };
}

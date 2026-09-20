import type { AppLocation, AppReport, InstalledApp } from '../types';
import { measure } from '../fs/walker';
import { resolveAppLocations } from './locations';
import { profileForBundleId } from './profiles';

export interface BuildAppReportsOptions {
  home: string;
  fullDiskAccess: boolean;
  apps: InstalledApp[];
  signal?: AbortSignal;
}

export async function buildAppReports(opts: BuildAppReportsOptions): Promise<AppReport[]> {
  const reports: AppReport[] = [];

  for (const app of opts.apps) {
    if (opts.signal?.aborted) break;

    const specs = await resolveAppLocations(app, {
      home: opts.home,
      fullDiskAccess: opts.fullDiskAccess,
    });
    if (specs.length === 0) continue;

    // One shared `seen` set per app: caches are measured before app-data, so a
    // cache directory inside Application Support is not counted a second time.
    const seen = new Set<string>();
    const locations: AppLocation[] = [];
    for (const spec of specs) {
      const result = await measure(spec.path, {
        seen,
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      if (result.allocated === 0) continue;
      locations.push({ ...spec, bytesAllocated: result.allocated });
    }
    if (locations.length === 0) continue;

    let cleanable = 0;
    let data = 0;
    for (const location of locations) {
      if (location.state === 'cleanable') cleanable += location.bytesAllocated;
      else data += location.bytesAllocated;
    }

    const profile = profileForBundleId(app.bundleId);
    reports.push({
      app,
      ...(profile ? { profileId: profile.id } : {}),
      locations,
      totals: { cleanable, data, all: cleanable + data },
    });
  }

  reports.sort(
    (a, b) => b.totals.cleanable - a.totals.cleanable || b.totals.all - a.totals.all,
  );
  return reports;
}

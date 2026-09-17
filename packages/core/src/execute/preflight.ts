import { runningApps } from '../native/helper';
import { resolveBin } from '../probes/bin-resolver';
import type { Preflight, ProbeRunner } from '../types';

export interface PreflightDeps {
  runningBundleIds?: () => Promise<string[]>;
}

const defaultRunningBundleIds = async (): Promise<string[]> =>
  (await runningApps()).apps.map((a) => a.bundleId);

export async function checkPreflight(
  pf: Preflight | undefined,
  run: ProbeRunner,
  deps: PreflightDeps = {},
): Promise<string[]> {
  if (!pf) return [];

  const blockers: string[] = [];

  if (pf.apps?.length) {
    try {
      const running = new Set(await (deps.runningBundleIds ?? defaultRunningBundleIds)());
      for (const app of pf.apps) {
        if (running.has(app.bundleId)) blockers.push(`${app.name} is running`);
      }
    } catch {
      // Fail closed: without the helper we cannot prove the app is closed.
      for (const app of pf.apps) {
        blockers.push(`Can't confirm ${app.name} is closed (native helper unavailable)`);
      }
    }
  }

  for (const name of pf.processes ?? []) {
    const result = await run('pgrep', ['-x', name]);
    if (result.exitCode === 0) blockers.push(`${name} is running`);
  }

  if (pf.daemons?.includes('docker')) {
    const docker = await resolveBin('docker', { run });
    if (docker) {
      const result = await run(docker, ['info', '--format', '{{.ServerVersion}}']);
      if (result.exitCode === 0) blockers.push('Docker is running');
    }
  }

  if (pf.bootedSimulators) {
    const result = await run('xcrun', ['simctl', 'list', 'devices', 'booted', '-j']);
    try {
      const parsed = JSON.parse(result.stdout) as { devices?: Record<string, unknown[]> };
      const devices = parsed.devices ?? {};
      const booted = Object.values(devices).some((list) => Array.isArray(list) && list.length > 0);
      if (booted) blockers.push('A simulator is booted');
    } catch {
      // A parse error means we learned nothing, so it is not a blocker.
    }
  }

  return blockers;
}

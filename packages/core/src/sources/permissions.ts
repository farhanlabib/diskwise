import { readdir } from 'node:fs/promises';
import type { PermissionStatus } from '../types';
import { detectHostApp, hostAppFromTermProgram } from './host-app';

export interface CheckFullDiskAccessDeps {
  readdir?: (p: string) => Promise<unknown>;
  detectHostApp?: () => Promise<{ name: string; path: string } | undefined>;
}

function permissionErrorCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | null)?.code;
}

export async function checkFullDiskAccess(
  home: string,
  deps: CheckFullDiskAccessDeps = {},
): Promise<PermissionStatus> {
  const read = deps.readdir ?? readdir;
  const detect = deps.detectHostApp ?? detectHostApp;
  const detected = await detect();
  const hostApp = detected?.name ?? hostAppFromTermProgram(process.env.TERM_PROGRAM);

  // TCC blocks reads of these directories until the *hosting* app (the terminal)
  // has Full Disk Access, so they double as a probe for the permission itself.
  const probes = [`${home}/Library/Safari`, `${home}/Library/Mail`];
  let deniedExisting = 0;

  for (const path of probes) {
    try {
      await read(path);
      return { fullDiskAccess: 'granted', hostApp };
    } catch (err) {
      const code = permissionErrorCode(err);
      if (code === 'EPERM' || code === 'EACCES') {
        deniedExisting += 1;
      }
    }
  }

  if (deniedExisting > 0) {
    const who = hostApp ?? 'your terminal app';
    return {
      fullDiskAccess: 'limited',
      hostApp,
      hint: `Grant Full Disk Access to ${who} in System Settings → Privacy & Security → Full Disk Access, then quit and reopen ${who}.`,
    };
  }

  return { fullDiskAccess: 'unknown', hostApp };
}

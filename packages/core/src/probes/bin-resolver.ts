import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ProbeRunner } from '../types';
import { runProbe } from './run';

// A probe with a bare PATH (e.g. from a GUI app) still needs to find the tools
// the user installed, so we check the usual install prefixes first and only
// fall back to asking a login shell when nothing on disk matches.
const VALID_NAME = /^[a-z0-9._-]+$/i;

function knownDirs(home: string): string[] {
  return [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    `${home}/.local/bin`,
    `${home}/.cargo/bin`,
    `${home}/go/bin`,
    `${home}/.volta/bin`,
    '/Applications/Docker.app/Contents/Resources/bin',
  ];
}

const cache = new Map<string, string | null>();

export interface ResolveBinDeps {
  home?: string;
  exists?: (p: string) => Promise<boolean>;
  run?: ProbeRunner;
}

export async function resolveBin(name: string, deps: ResolveBinDeps = {}): Promise<string | null> {
  const cached = cache.get(name);
  if (cached !== undefined) return cached;

  const home = deps.home ?? homedir();
  const exists =
    deps.exists ??
    ((p: string): Promise<boolean> =>
      access(p, constants.X_OK).then(
        () => true,
        () => false,
      ));
  const run = deps.run ?? runProbe;

  for (const dir of knownDirs(home)) {
    const candidate = join(dir, name);
    if (await exists(candidate)) {
      cache.set(name, candidate);
      return candidate;
    }
  }

  // Never interpolate an arbitrary name into a shell command.
  if (!VALID_NAME.test(name)) {
    cache.set(name, null);
    return null;
  }

  const shell = process.env.SHELL ?? '/bin/zsh';
  const result = await run(shell, ['-ilc', `command -v ${name}`]);
  if (result.exitCode === 0) {
    const line = result.stdout
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.startsWith('/'));
    if (line) {
      cache.set(name, line);
      return line;
    }
  }

  cache.set(name, null);
  return null;
}

export function clearBinCache(): void {
  cache.clear();
}

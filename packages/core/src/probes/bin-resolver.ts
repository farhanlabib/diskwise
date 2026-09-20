import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

// A probe with a bare PATH (e.g. from a GUI app) still needs to find the tools
// the user installed, so we check the usual install prefixes before the
// inherited PATH. Resolution never spawns a shell: startup files could have
// side effects, and the safety checklist forbids shells outright.
const KNOWN_DIRS = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
];

function homeDirs(home: string): string[] {
  return [
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
  pathEnv?: string;
  exists?: (p: string) => Promise<boolean>;
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

  const pathEnv = deps.pathEnv ?? process.env.PATH ?? '';
  const dirs = [...KNOWN_DIRS, ...homeDirs(home), ...pathEnv.split(':')];
  const seen = new Set<string>();

  for (const dir of dirs) {
    if (dir.length === 0 || seen.has(dir)) continue;
    seen.add(dir);
    const candidate = join(dir, name);
    if (await exists(candidate)) {
      cache.set(name, candidate);
      return candidate;
    }
  }

  cache.set(name, null);
  return null;
}

export function clearBinCache(): void {
  cache.clear();
}

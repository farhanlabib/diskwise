import type { Candidate } from '../../types';

interface RawRuntime {
  identifier?: string;
  version?: string;
  build?: string;
  platformIdentifier?: string;
  sizeBytes?: number;
  state?: string;
  deletable?: boolean;
  lastUsedAt?: string | null;
}

const PLATFORM_NAMES: readonly [needle: string, name: string][] = [
  ['iphonesimulator', 'iOS'],
  ['watchsimulator', 'watchOS'],
  ['appletvsimulator', 'tvOS'],
  ['xrsimulator', 'visionOS'],
];

function platformName(platformIdentifier: string): string {
  const lower = platformIdentifier.toLowerCase();
  for (const [needle, name] of PLATFORM_NAMES) {
    if (lower.includes(needle)) return name;
  }
  return platformIdentifier || 'unknown';
}

function formatLastUsed(lastUsedAt: string | null | undefined): string {
  if (!lastUsedAt) return 'never used';
  const dateOnly = /^\d{4}-\d{2}-\d{2}/.exec(lastUsedAt);
  return `last used ${dateOnly ? dateOnly[0] : lastUsedAt}`;
}

export function parseSimctlRuntimes(json: string): Candidate[] {
  const parsed = JSON.parse(json) as Record<string, RawRuntime>;
  const candidates: Candidate[] = [];

  for (const [uuid, runtime] of Object.entries(parsed)) {
    if (!runtime || typeof runtime !== 'object') continue;
    if (runtime.deletable === false) continue;

    const size = typeof runtime.sizeBytes === 'number' ? runtime.sizeBytes : 0;
    const platform = platformName(runtime.platformIdentifier ?? '');
    const version = runtime.version ?? '';
    const build = runtime.build ?? '';
    const head = [platform, version].filter((part) => part.length > 0).join(' ');
    const detail = `${head}${build ? ` (${build})` : ''}, ${formatLastUsed(runtime.lastUsedAt)}`;

    candidates.push({
      kind: 'virtual',
      detail,
      actionArgs: { uuid },
      bytesHint: { allocated: size, apparent: size },
    });
  }

  return candidates;
}

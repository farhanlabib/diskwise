// Shared contracts for the whole engine. Every module in core, report, server,
// cli and ui builds against these types. Change them deliberately.

export type Tier = 0 | 1 | 2 | 3;

export const TIER_NAMES = {
  0: 'REGENERATES',
  1: 'REDOWNLOAD',
  2: 'USER_DATA',
  3: 'NEVER',
} as const;

export type Category = 'dev' | 'system' | 'browser' | 'app' | 'user-data' | 'os-leftovers';

export type DepId =
  | 'xcode'
  | 'docker'
  | 'homebrew'
  | 'node'
  | 'pnpm'
  | 'yarn'
  | 'uv'
  | 'go'
  | 'python'
  | 'rust'
  | 'cocoapods';

export type ActionId =
  | 'simctl-runtime-delete'
  | 'simctl-device-delete-unavailable'
  | 'simctl-device-delete'
  | 'brew-cleanup'
  | 'docker-builder-prune'
  | 'docker-image-prune'
  | 'docker-container-prune'
  | 'npm-cache-clean'
  | 'pnpm-store-prune'
  | 'yarn-cache-clean'
  | 'uv-cache-clean'
  | 'go-clean-build'
  | 'go-clean-mod'
  | 'trash-path'
  | 'remove-path'
  | 'remove-dir-contents'
  | 'empty-trash';

export type ProbeId = 'simctl-runtimes' | 'simctl-devices' | 'docker-df' | 'macos-installers';

// Paths in rules may start with "~/" which resolves to MatcherContext.home.
export type MatcherSpec =
  | { kind: 'path'; path: string }
  | { kind: 'glob-children'; root: string; include?: string[]; exclude?: string[] }
  | {
      kind: 'project-dirs';
      searchRoots: string[];
      name: string;
      marker: string;
      maxAgeDays: number;
      excludePrefixes: string[];
      maxDepth?: number;
    }
  | { kind: 'probe'; probe: ProbeId };

export interface Preflight {
  processes?: string[];
  daemons?: 'docker'[];
  bootedSimulators?: boolean;
}

export interface Rule {
  schemaVersion: 1;
  id: string;
  title: string;
  category: Category;
  tier: Tier;
  macos?: string;
  requires?: DepId[];
  roots: string[];
  matcher: MatcherSpec;
  action: ActionId | null;
  rationale: string;
  regeneration: string;
  preflight?: Preflight;
  minBytes?: number;
  needsRoot?: boolean;
  manualCommand?: string;
  permanentOnly?: boolean;
  docs?: string;
}

// What a matcher returns: something that might be reclaimable, before sizing.
export interface Candidate {
  kind: 'dir' | 'file' | 'virtual';
  path?: string;
  detail: string;
  actionArgs?: Record<string, string>;
  appBundleId?: string;
  // Probe-backed (virtual) candidates carry sizes reported by the vendor tool.
  bytesHint?: { allocated: number; apparent: number };
  // Set by a matcher when a guard downgrades the item, e.g. node_modules without a lockfile.
  tierOverride?: Tier;
  reportOnly?: boolean;
}

export interface UnreadableEntry {
  path: string;
  code: 'EPERM' | 'EACCES';
}

export interface SizeInfo {
  allocated: number;
  apparent: number;
  entries: number;
  unreadable: UnreadableEntry[];
  cloudPlaceholders: number;
}

export interface WalkProgress {
  entries: number;
  path: string;
}

export interface WalkOptions {
  maxDepth?: number;
  maxEntries?: number;
  signal?: AbortSignal;
  onProgress?: (p: WalkProgress) => void;
  // Absolute paths never descended into.
  skip?: string[];
  // Shared across walks in one scan so a hardlink is counted once overall. Key: `${dev}:${ino}`.
  seen?: Set<string>;
  concurrency?: number;
}

export interface WalkResult extends SizeInfo {
  truncated: boolean;
  aborted: boolean;
}

export interface Match extends Candidate {
  dev?: number;
  ino?: number;
  bytesAllocated: number;
  bytesApparent: number;
  bytesReclaimable?: number;
  unreadable?: UnreadableEntry[];
}

export interface Finding {
  ruleId: string;
  title: string;
  category: Category;
  tier: Tier;
  rationale: string;
  regeneration: string;
  action: ActionId | null;
  needsRoot: boolean;
  manualCommand?: string;
  permanentOnly: boolean;
  blockedBy?: string[];
  matches: Match[];
  totals: { allocated: number; apparent: number };
}

export interface Trap {
  path: string;
  allocated: number;
  apparent: number;
  note: string;
}

export interface ProbeResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type ProbeRunner = (
  bin: string,
  args: string[],
  opts?: { timeoutMs?: number; env?: Record<string, string> },
) => Promise<ProbeResult>;

export interface MatcherContext {
  home: string;
  now: Date;
  signal?: AbortSignal;
  run: ProbeRunner;
}

export interface DiskInfo {
  mountPoint: string;
  volumeName: string;
  containerTotal: number;
  containerUsed: number;
  containerFree: number;
  volumeUsed: number;
  caseSensitive: boolean;
  purgeable?: number;
}

export interface PermissionStatus {
  fullDiskAccess: 'granted' | 'limited' | 'unknown';
  hostApp?: string;
  hint?: string;
}

export interface AuditResult {
  schemaVersion: 1;
  generatedAt: string;
  macosVersion?: string;
  disk?: DiskInfo;
  permissions?: PermissionStatus;
  findings: Finding[];
  traps: Trap[];
  unreadable: UnreadableEntry[];
  totals: {
    byTier: Record<Tier, number>;
    reclaimable: number;
  };
}

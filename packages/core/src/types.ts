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
  | {
      kind: 'glob-children';
      root: string;
      include?: string[];
      exclude?: string[];
      // Only children whose own mtime is older than this many days.
      olderThanDays?: number;
    }
  | {
      kind: 'project-dirs';
      searchRoots: string[];
      name: string;
      marker: string;
      maxAgeDays: number;
      excludePrefixes: string[];
      maxDepth?: number;
    }
  | { kind: 'probe'; probe: ProbeId }
  // Children of root whose names are versions (e.g. "17.4 (21E213)", "MacOSX14.2.sdk"),
  // excluding the newest `keepNewest` and any child that is the target of a sibling symlink.
  | { kind: 'versioned-children'; root: string; include?: string[]; keepNewest: number };

export interface Preflight {
  processes?: string[];
  daemons?: 'docker'[];
  bootedSimulators?: boolean;
  // GUI apps that must be closed, matched by bundle id through the native helper.
  apps?: { bundleId: string; name: string }[];
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
  // reclaimable is set when clone-aware sizing ran: bytes actually freed if deleted.
  totals: { allocated: number; apparent: number; reclaimable?: number };
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
  systemData?: SystemDataReport;
  totals: {
    byTier: Record<Tier, number>;
    reclaimable: number;
  };
}

// ---------------------------------------------------------------------------
// Plans (packages/core/src/plan)

export interface PlanItem {
  // `${ruleId}#${matchIndex}`: stable within one audit.
  id: string;
  ruleId: string;
  title: string;
  category: Category;
  tier: Tier;
  action: ActionId;
  permanentOnly: boolean;
  // Tier 2 or permanentOnly items need the rule id typed back before they run.
  needsConfirmation: boolean;
  preflight?: Preflight;
  roots: string[];
  match: Match;
}

export interface ManualStep {
  ruleId: string;
  title: string;
  command: string;
  bytes: number;
}

export interface CleanupPlan {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  auditGeneratedAt: string;
  items: PlanItem[];
  manual: ManualStep[];
  totals: { byTier: Record<Tier, number>; total: number };
}

export interface PlanSelection {
  tiers?: Tier[];
  categories?: Category[];
  ruleIds?: string[];
  itemIds?: string[];
}

// ---------------------------------------------------------------------------
// Execution (packages/core/src/execute)

export type ItemStatus = 'done' | 'dry-run' | 'skipped' | 'failed';

export interface ItemResult {
  itemId: string;
  ruleId: string;
  action: ActionId;
  status: ItemStatus;
  reason?: string;
  path?: string;
  trashedPath?: string;
  bytesBefore: number;
  bytesAfter: number;
  freed: number;
  restorable: boolean;
}

export interface ExecuteOptions {
  apply: boolean;
  // Rule ids the user typed back; required for items with needsConfirmation.
  confirmedRuleIds?: string[];
  // Tier 2 rule ids the user explicitly asked to delete permanently instead of moving
  // to Trash (--permanent). Each must also be in confirmedRuleIds.
  permanentRuleIds?: string[];
  home?: string;
  run?: ProbeRunner;
  signal?: AbortSignal;
  onItem?: (r: ItemResult) => void;
  journal?: JournalWriter;
  // Test seam: defaults to the native helper's trash command.
  trash?: (path: string) => Promise<{ trashedPath: string }>;
  // Test seam: defaults to the native helper's running-apps command.
  runningBundleIds?: () => Promise<string[]>;
}

export interface ExecuteResult {
  planId: string;
  runId?: string;
  apply: boolean;
  results: ItemResult[];
  freed: number;
}

// ---------------------------------------------------------------------------
// Journal (packages/core/src/journal)

export type JournalRecord =
  | { type: 'run-start'; runId: string; planId: string; at: string; apply: boolean; itemCount: number }
  | { type: 'intent'; runId: string; at: string; itemId: string; ruleId: string; action: ActionId; path?: string }
  | { type: 'result'; runId: string; at: string; result: ItemResult }
  | { type: 'run-end'; runId: string; at: string; freed: number }
  | { type: 'undo'; runId: string; at: string; itemId: string; restoredPath: string };

export interface JournalWriter {
  runId: string;
  append(record: JournalRecord): Promise<void>;
  close(): Promise<void>;
}

export interface RunSummary {
  runId: string;
  planId: string;
  startedAt: string;
  endedAt?: string;
  apply: boolean;
  itemCount: number;
  freed: number;
  restorableCount: number;
  // intent records without a matching result: the run crashed mid-action.
  incomplete: boolean;
}

export interface UndoItemResult {
  itemId: string;
  path?: string;
  status: 'restored' | 'not-restorable' | 'missing-from-trash' | 'destination-exists' | 'failed';
  reason?: string;
}

// ---------------------------------------------------------------------------
// Apps (packages/core/src/apps)

export type AppLocationKind =
  | 'caches'
  | 'logs'
  | 'saved-state'
  | 'sign-in-data'
  | 'app-data'
  | 'settings';

export interface AppLocation {
  kind: AppLocationKind;
  tier: Tier;
  // Only caches/logs/saved-state are ever actionable.
  actionable: boolean;
  path: string;
  bytesAllocated: number;
  source: 'profile' | 'generic';
  // Profile-provided explanation, e.g. "Offline songs; Spotify downloads them again".
  note?: string;
}

export interface InstalledApp {
  bundleId: string;
  name: string;
  version?: string;
  path: string;
  teamId?: string;
  lastUsed?: string;
  running: boolean;
  bundleBytes: number;
  system: boolean;
}

export interface AppReport {
  app: InstalledApp;
  // Data left behind by an app that is no longer installed (app.path is '').
  orphaned?: boolean;
  profileId?: string;
  locations: AppLocation[];
  totals: { cleanable: number; data: number; all: number };
}

// Declarative, reviewed knowledge about one popular app (packages/core/src/apps/profiles).
export interface AppProfile {
  schemaVersion: 1;
  id: string;
  name: string;
  bundleIds: string[];
  // Extra cleanable locations beyond the generic ones; '~/' paths. Tier 0 or 1 only.
  caches: { path: string; tier: 0 | 1; note?: string }[];
  // Generic cache locations that must NOT be offered for this app (e.g. an offline library).
  protect?: string[];
  rationale: string;
  regeneration: string;
}

// ---------------------------------------------------------------------------
// System Data decomposition (packages/core/src/sources/system-data.ts)

export interface SystemDataBucket {
  id: string;
  title: string;
  path?: string;
  bytes: number;
  tier: Tier | 'mixed';
  explanation: string;
  manualCommand?: string;
  children?: SystemDataBucket[];
}

export interface SystemDataReport {
  // Estimate of what macOS calls System Data: container used minus apps and visible user files.
  total: number;
  measured: number;
  unmeasured: number;
  buckets: SystemDataBucket[];
  snapshots: { name: string; date?: string }[];
}

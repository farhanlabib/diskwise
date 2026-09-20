import type { AuditResult, DiskInfo, Finding, PermissionStatus, Tier, Trap } from '@diskwise/core/types';
import type {
  AppEntry,
  AppLocationGroup,
  DiskSegment,
  HistoryRun,
  LargestWin,
  RunItem,
  ScanBucket,
  SystemBucket,
} from './types';

const KB = 1_000;
const MB = 1_000_000;
const GB = 1_000_000_000;

export const disk: DiskInfo = {
  mountPoint: '/',
  volumeName: 'Macintosh HD',
  containerTotal: 494 * GB,
  containerUsed: 228 * GB,
  containerFree: 266 * GB,
  volumeUsed: 228 * GB,
  caseSensitive: false,
  purgeable: 9 * GB,
};

export const permissions: PermissionStatus = {
  fullDiskAccess: 'limited',
  hostApp: 'iTerm2',
  hint: 'Grant Full Disk Access to iTerm2 in System Settings → Privacy & Security.',
};

function match(path: string, detail: string, bytes: number) {
  return { kind: 'dir' as const, path, detail, bytesAllocated: bytes, bytesApparent: bytes };
}

export const findings: Finding[] = [
  {
    ruleId: 'xcode.derived-data',
    title: 'Xcode DerivedData',
    category: 'dev',
    tier: 0,
    rationale:
      'DerivedData holds build intermediates and indexes. Xcode regenerates it on your next build.',
    regeneration: 'A clean build of your projects — a few minutes of compile time. No network needed.',
    action: 'remove-path',
    needsRoot: false,
    permanentOnly: false,
    manualCommand: 'rm -rf ~/Library/Developer/Xcode/DerivedData/*',
    matches: [
      match(
        '~/Library/Developer/Xcode/DerivedData',
        '8.4 GB of build intermediates',
        8.4 * GB,
      ),
    ],
    totals: { allocated: 8.4 * GB, apparent: 8.6 * GB },
  },
  {
    ruleId: 'docker.build-cache',
    title: 'Docker build cache',
    category: 'system',
    tier: 0,
    rationale: 'Layer cache from Docker image builds.',
    regeneration: 'Slower first build of each image; layers rebuild locally.',
    action: 'docker-builder-prune',
    needsRoot: false,
    permanentOnly: false,
    blockedBy: ['Docker'],
    manualCommand: 'docker builder prune -f',
    matches: [match('(managed by docker)', 'docker builder prune', 3.1 * GB)],
    totals: { allocated: 3.1 * GB, apparent: 3.1 * GB },
  },
  {
    ruleId: 'simulator.runtimes',
    title: 'iOS 26.1 simulator runtime',
    category: 'dev',
    tier: 1,
    rationale: 'A downloaded simulator runtime image. No user data lives here.',
    regeneration: 'Xcode re-downloads it (~2–4 GB) if you target iOS 26.1 again.',
    action: 'simctl-runtime-delete',
    needsRoot: false,
    permanentOnly: false,
    manualCommand: 'xcrun simctl runtime delete 3F2A1C8E-…',
    matches: [
      match(
        '/Library/Developer/CoreSimulator/Images',
        'iOS 26.1 (23B86), unused 94 days',
        16 * GB,
      ),
    ],
    totals: { allocated: 16 * GB, apparent: 16 * GB },
  },
  {
    ruleId: 'homebrew.cache',
    title: 'Homebrew download cache',
    category: 'system',
    tier: 1,
    rationale: 'Old bottle archives already installed.',
    regeneration: 'brew re-downloads a bottle only if you reinstall that formula.',
    action: 'brew-cleanup',
    needsRoot: false,
    permanentOnly: false,
    manualCommand: 'brew cleanup -s',
    matches: [match('~/Library/Caches/Homebrew', 'bottle archives', 1.9 * GB)],
    totals: { allocated: 1.9 * GB, apparent: 1.9 * GB },
  },
  {
    ruleId: 'dev.node-modules',
    title: 'node_modules in 41 projects',
    category: 'dev',
    tier: 1,
    rationale:
      'Reinstallable dependencies in projects you haven’t touched in 2+ weeks. Each has a lockfile, so versions are pinned.',
    regeneration: 'npm/pnpm install per project — network + a minute each.',
    action: 'remove-path',
    needsRoot: false,
    permanentOnly: false,
    manualCommand: 'rm -rf <project>/node_modules  (×41)',
    matches: [match('41 project folders', 'untouched 14+ days · lockfiles present', 7.2 * GB)],
    totals: { allocated: 7.2 * GB, apparent: 7.4 * GB },
  },
  {
    ruleId: 'simulator.dyld-cache',
    title: 'Simulator dyld cache',
    category: 'dev',
    tier: 1,
    rationale: 'Shared dynamic linker cache for simulators.',
    regeneration: 'Rebuilt automatically by the simulator.',
    action: null,
    needsRoot: true,
    permanentOnly: false,
    manualCommand: 'sudo rm -rf /Library/Developer/CoreSimulator/Caches/dyld',
    matches: [match('/Library/Developer/CoreSimulator/Caches/dyld', 'needs root', 2.3 * GB)],
    totals: { allocated: 2.3 * GB, apparent: 2.3 * GB },
  },
  {
    ruleId: 'ios.backups',
    title: 'iOS device backups',
    category: 'user-data',
    tier: 2,
    rationale:
      'Local backups of iOS devices. This is your data, so it moves to the Trash.',
    regeneration: 'Only recoverable from the Trash, or by re-backing-up the device.',
    action: 'trash-path',
    needsRoot: false,
    permanentOnly: false,
    manualCommand: 'trash ~/Library/Application Support/MobileSync/Backup/*',
    matches: [
      match('~/Library/Application Support/MobileSync/Backup', '2 devices', 1.4 * GB),
    ],
    totals: { allocated: 1.4 * GB, apparent: 1.4 * GB },
  },
  {
    ruleId: 'docker.volumes',
    title: 'Docker volumes (4)',
    category: 'system',
    tier: 3,
    rationale: 'Named Docker volumes — Postgres, Redis and MySQL data. DiskWise never deletes these.',
    regeneration: 'Not applicable — protected.',
    action: null,
    needsRoot: false,
    permanentOnly: false,
    manualCommand: '(review in Docker)',
    matches: [match('(docker volumes)', 'Databases live here', 2.2 * GB)],
    totals: { allocated: 2.2 * GB, apparent: 2.2 * GB },
  },
];

export const traps: Trap[] = [
  {
    path: '~/Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw',
    allocated: 2.7 * GB,
    apparent: 228 * GB,
    note: 'Sparse file — Finder shows the apparent size, only 2.7 GB is allocated.',
  },
];

export const byTier: Record<Tier, number> = {
  0: 12.1 * GB,
  1: 24.9 * GB,
  2: 1.4 * GB,
  3: 2.2 * GB,
};

export const audit: AuditResult = {
  schemaVersion: 1,
  generatedAt: '2026-09-17T14:12:00.000Z',
  macosVersion: '15.6',
  disk,
  permissions,
  findings,
  traps,
  unreadable: [
    { path: '~/Library/Mail/V10', code: 'EPERM' },
    { path: '~/Library/Messages', code: 'EPERM' },
  ],
  totals: {
    byTier,
    reclaimable: 38.4 * GB,
  },
};

export const segments: DiskSegment[] = [
  { id: 'apps', label: 'Apps', sizeGb: 34, color: 'seg-apps' },
  { id: 'dev', label: 'Developer', sizeGb: 62, color: 'seg-dev' },
  { id: 'cache', label: 'Caches', sizeGb: 18, color: 'seg-cache' },
  { id: 'data', label: 'Your data', sizeGb: 41, color: 'seg-data' },
  { id: 'sys', label: 'System', sizeGb: 48, color: 'seg-sys' },
  { id: 'unmeasured', label: 'Unmeasured', sizeGb: 12, hatch: true },
  { id: 'purge', label: 'Purgeable', sizeGb: 9, color: 'seg-purge' },
  { id: 'free', label: 'Free', sizeGb: 266, color: 'seg-free' },
];

export const largestWins: LargestWin[] = [
  {
    ruleId: 'simulator.runtimes',
    title: 'iOS 26.1 simulator runtime',
    detail: 'Unused for 94 days',
    sizeBytes: 16 * GB,
    tier: 1,
  },
  {
    ruleId: 'xcode.derived-data',
    title: 'Xcode DerivedData',
    detail: 'Rebuilds on next build',
    sizeBytes: 8.4 * GB,
    tier: 0,
  },
  {
    ruleId: 'dev.node-modules',
    title: 'node_modules in 41 projects',
    detail: 'Untouched 14+ days',
    sizeBytes: 7.2 * GB,
    tier: 1,
  },
  {
    ruleId: 'homebrew.cache',
    title: 'Homebrew download cache',
    detail: 'brew cleanup -s',
    sizeBytes: 1.9 * GB,
    tier: 1,
  },
  {
    ruleId: 'docker.build-cache',
    title: 'Docker build cache',
    detail: 'docker builder prune',
    sizeBytes: 3.1 * GB,
    tier: 0,
  },
];

export const systemBuckets: SystemBucket[] = [
  {
    id: 'coresim',
    name: 'CoreSimulator runtimes & devices',
    note: 'iOS/watchOS runtime images and test devices',
    tier: 1,
    sizeBytes: 39.1 * GB,
    sizeLabel: '39.1 GB',
    path: '/Library/Developer/CoreSimulator',
    what: 'Simulator runtimes are downloaded disk images for building iOS apps. The 16 GB iOS 26.1 runtime hasn’t been used in 94 days.',
    safe:
      'Safe. Deleting a runtime frees it immediately; Xcode re-downloads it (~2–4 GB) only if you target that iOS version again.',
    reviewable: true,
  },
  {
    id: 'var',
    name: '/private/var (swap, databases, temp)',
    note: 'Managed by macOS',
    tier: 3,
    sizeBytes: 7.7 * GB,
    sizeLabel: '7.7 GB',
    path: '/private/var',
    what: 'Swap files, system databases and temporary files. macOS manages the size of these automatically.',
    safe: 'Protected. DiskWise never touches these — deleting them can corrupt the system.',
    reviewable: false,
  },
  {
    id: 'brew',
    name: 'Homebrew (/opt/homebrew)',
    note: 'Installed packages + download cache',
    tier: 1,
    sizeBytes: 5 * GB,
    sizeLabel: '5.0 GB',
    path: '/opt/homebrew',
    what: 'Homebrew formulae plus a download cache of old bottle archives.',
    safe:
      'The download cache (~1.9 GB) is safe to clear with brew cleanup. Installed packages themselves are kept.',
    reviewable: true,
  },
  {
    id: 'chrome',
    name: 'Chrome on-device AI model',
    note: 'Downloaded silently by Chrome',
    tier: 1,
    sizeBytes: 4 * GB,
    sizeLabel: '4.0 GB',
    path: '~/Library/Application Support/Google/Chrome/OptGuideOnDeviceModel',
    what: 'A 4 GB on-device AI model Chrome downloaded in the background.',
    safe:
      'Safe to delete. Chrome will re-download it (~4 GB) unless you disable the feature via policy.',
    command: 'defaults write com.google.Chrome GenAILocalFoundationalModelSettings -int 1',
    reviewable: true,
  },
  {
    id: 'snapshots',
    name: 'Local Time Machine snapshots',
    note: '3 snapshots',
    tier: 3,
    sizeBytes: 2 * GB,
    sizeLabel: '—',
    path: 'APFS local snapshots',
    what: 'Three local Time Machine snapshots. Their size can’t be measured without root.',
    safe:
      'Protected. Size not measurable without root — use the copy-paste command to thin them yourself.',
    command: 'tmutil thinlocalsnapshots / 20000000000 4',
    reviewable: false,
  },
  {
    id: 'unmeasured',
    name: 'Unmeasured (protected / needs root)',
    note: 'Couldn’t be read',
    tier: 3,
    sizeBytes: 11.6 * GB,
    sizeLabel: '11.6 GB',
    path: 'various',
    what:
      'Areas DiskWise couldn’t read: SIP-protected paths and folders that need root. Shown as a hatched bucket so the total always adds up honestly.',
    safe:
      'Not actionable. These bytes exist but can’t be safely inspected without elevated access.',
    reviewable: false,
  },
];

export const apps: AppEntry[] = [
  {
    id: 'spotify',
    name: 'Spotify',
    initial: 'S',
    bundleId: 'com.spotify.client',
    version: 'v1.2.3',
    lastUsed: '2 days ago',
    running: false,
    orphan: false,
    knownProfile: true,
    cachesBytes: 3.1 * GB,
    appDataBytes: 1.1 * GB,
    totalBytes: 4.2 * GB,
    color: '#1db954',
  },
  {
    id: 'teams',
    name: 'Microsoft Teams',
    initial: 'T',
    bundleId: 'com.microsoft.teams2',
    version: 'v24.9',
    lastUsed: '5 days ago',
    running: false,
    orphan: false,
    knownProfile: true,
    cachesBytes: 2.6 * GB,
    appDataBytes: 780 * MB,
    totalBytes: 3.4 * GB,
    color: '#5059c9',
  },
  {
    id: 'slack',
    name: 'Slack',
    initial: 'S',
    bundleId: 'com.tinyspeck.slackmacgap',
    version: 'v4.38',
    lastUsed: 'now',
    running: true,
    orphan: false,
    knownProfile: true,
    cachesBytes: 1.8 * GB,
    appDataBytes: 2.4 * GB,
    totalBytes: 4.2 * GB,
    color: '#4a154b',
  },
  {
    id: 'discord',
    name: 'Discord',
    initial: 'D',
    bundleId: 'com.hnc.Discord',
    version: 'v0.0.3',
    lastUsed: 'yesterday',
    running: false,
    orphan: false,
    knownProfile: true,
    cachesBytes: 1.2 * GB,
    appDataBytes: 340 * MB,
    totalBytes: 1.5 * GB,
    color: '#5865f2',
  },
  {
    id: 'vscode',
    name: 'Visual Studio Code',
    initial: 'V',
    bundleId: 'com.microsoft.VSCode',
    version: 'v1.93',
    lastUsed: 'now',
    running: true,
    orphan: false,
    knownProfile: true,
    cachesBytes: 940 * MB,
    appDataBytes: 1.9 * GB,
    totalBytes: 2.8 * GB,
    color: '#0078d4',
  },
  {
    id: 'figma',
    name: 'Figma',
    initial: 'F',
    bundleId: 'com.figma.Desktop',
    version: 'v124.3',
    lastUsed: '3 days ago',
    running: false,
    orphan: false,
    knownProfile: true,
    cachesBytes: 610 * MB,
    appDataBytes: 420 * MB,
    totalBytes: 1 * GB,
    color: '#a259ff',
  },
  {
    id: 'zoom',
    name: 'Zoom',
    initial: 'Z',
    bundleId: 'us.zoom.xos',
    version: 'v6.1',
    lastUsed: '1 week ago',
    running: false,
    orphan: false,
    knownProfile: true,
    cachesBytes: 220 * MB,
    appDataBytes: 160 * MB,
    totalBytes: 380 * MB,
    color: '#2d8cff',
  },
  {
    id: 'orphan',
    name: 'com.tinyspeck.old-app',
    initial: '?',
    bundleId: 'com.tinyspeck.old-app',
    version: 'uninstalled',
    lastUsed: 'unknown',
    running: false,
    orphan: true,
    knownProfile: false,
    cachesBytes: 464 * MB,
    appDataBytes: 1.2 * GB,
    totalBytes: 464 * MB + 1.2 * GB,
    color: '#8a8a90',
  },
];

const slackGroups: AppLocationGroup[] = [
  {
    id: 'caches',
    name: 'Caches',
    sizeBytes: 1.8 * GB,
    tier: 0,
    note: 'Slack rebuilds these when it opens. You stay signed in. Includes Cache, Code Cache, GPUCache and Service Worker.',
    folders: ['Cache', 'Code Cache', 'GPUCache', 'Service Worker'],
    action: 'clean',
  },
  {
    id: 'logs',
    name: 'Logs',
    sizeBytes: 120 * MB,
    tier: 1,
    note: 'Diagnostic history only.',
    action: 'clean',
  },
  {
    id: 'signin',
    name: 'Sign-in & site data',
    sizeBytes: 64 * MB,
    tier: 2,
    note: 'Deleting this would sign you out.',
    noAction: 'Report only — no checkbox.',
    action: 'report',
  },
  {
    id: 'appdata',
    name: 'App data',
    sizeBytes: 2.4 * GB,
    tier: 2,
    note: 'Your messages, downloads and workspaces.',
    noAction: 'Report only — Show in Finder.',
    action: 'finder',
  },
  {
    id: 'settings',
    name: 'Settings',
    sizeBytes: 12 * KB,
    tier: 3,
    note: 'Preferences plist.',
    noAction: 'Protected.',
    action: 'protected',
  },
];

export function locationGroups(app: AppEntry): AppLocationGroup[] {
  if (app.id === 'slack') return slackGroups;
  if (app.orphan) {
    return [
      {
        id: 'caches',
        name: 'Caches',
        sizeBytes: app.cachesBytes,
        tier: 0,
        note: 'Left behind when this app was uninstalled. Safe to clear.',
        action: 'clean',
      },
      {
        id: 'logs',
        name: 'Logs',
        sizeBytes: 64 * MB,
        tier: 1,
        note: 'Diagnostic history from an app that is no longer installed.',
        action: 'clean',
      },
      {
        id: 'appdata',
        name: 'App data',
        sizeBytes: app.appDataBytes,
        tier: 2,
        note: 'User data left behind by the uninstalled app. Never cleaned like a cache — you move it to the Trash and can undo that.',
        action: 'trash',
      },
    ];
  }
  return [
    {
      id: 'caches',
      name: 'Caches',
      sizeBytes: app.cachesBytes,
      tier: 0,
      note: `${app.name} rebuilds these when it opens. You stay signed in.`,
      action: 'clean',
    },
    {
      id: 'appdata',
      name: 'App data',
      sizeBytes: app.appDataBytes,
      tier: 2,
      note: 'Your files and settings for this app.',
      noAction: 'Report only — Show in Finder.',
      action: 'finder',
    },
    {
      id: 'settings',
      name: 'Settings',
      sizeBytes: 12 * KB,
      tier: 3,
      note: 'Preferences plist.',
      noAction: 'Protected.',
      action: 'protected',
    },
  ];
}

export const history: HistoryRun[] = [
  {
    id: 'run-today',
    date: 'Today, 2:14 PM',
    items: 5,
    freedBytes: 20.8 * GB,
    undoable: true,
  },
  {
    id: 'run-sep12',
    date: 'Sep 12, 9:03 AM',
    items: 3,
    freedBytes: 11.2 * GB,
    undoable: false,
    reason: 'Rebuilds automatically',
  },
  {
    id: 'run-sep4',
    date: 'Sep 4, 6:41 PM',
    items: 8,
    freedBytes: 32.6 * GB,
    undoable: false,
    reason: 'Trash was emptied',
  },
];

export const runItems: RunItem[] = [
  { id: 'derived', title: 'Xcode DerivedData', sizeBytes: 8.4 * GB, freedBytes: 8.4 * GB },
  {
    id: 'iosrt',
    title: 'iOS 26.1 simulator runtime',
    sizeBytes: 16 * GB,
    freedBytes: 16 * GB,
  },
  {
    id: 'brewcache',
    title: 'Homebrew download cache',
    sizeBytes: 1.9 * GB,
    freedBytes: 1.9 * GB,
  },
  {
    id: 'nodemods',
    title: 'node_modules (41 projects)',
    sizeBytes: 7.2 * GB,
    freedBytes: 7.1 * GB,
  },
  {
    id: 'iosbackups',
    title: 'iOS device backups → Trash',
    sizeBytes: 1.4 * GB,
    freedBytes: 1.4 * GB,
  },
];

export const scanBuckets: ScanBucket[] = [
  { id: 'dev', label: 'Developer caches', state: 'done', sizeLabel: '24.9 GB' },
  { id: 'app', label: 'App caches', state: 'done', sizeLabel: '9.4 GB' },
  { id: 'system', label: 'System Data', state: 'scanning', sizeLabel: '—' },
  { id: 'downloads', label: 'Downloads', state: 'queued', sizeLabel: '' },
  { id: 'browser', label: 'Browser data', state: 'queued', sizeLabel: '' },
];

export const RUN_PLANNED = 21.3 * GB;
export const RUN_FREED = 20.8 * GB;

export const serverInfo = {
  address: '127.0.0.1:52814',
  version: '0.2.0',
};

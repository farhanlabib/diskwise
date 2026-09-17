import type { AuditResult, Finding, Trap, UnreadableEntry } from '@macsweep/core';

const GB = 1_000_000_000;

const findings: Finding[] = [
  {
    ruleId: 'xcode.derived-data',
    title: 'Xcode DerivedData',
    category: 'dev',
    tier: 0,
    rationale: 'Xcode rebuilds these from your source on the next build; nothing here is unique.',
    regeneration: 'Rebuilt locally on the next Xcode build (a few minutes)',
    action: 'remove-path',
    needsRoot: false,
    permanentOnly: false,
    matches: [
      {
        kind: 'dir',
        path: '~/Library/Developer/Xcode/DerivedData/acme-web-abc123',
        detail: 'acme-web-abc123 (last built 12 days ago)',
        bytesAllocated: 8.4 * GB,
        bytesApparent: 8.6 * GB,
      },
    ],
    totals: { allocated: 8.4 * GB, apparent: 8.6 * GB },
  },
  {
    ruleId: 'simulator.runtimes',
    title: 'iOS 26.1 simulator runtime',
    category: 'dev',
    tier: 1,
    rationale: 'No simulator uses this runtime, and iOS 26.1 is still downloadable from Apple.',
    regeneration: 'Re-download ~16 GB from Apple (Xcode → Settings → Components)',
    action: 'simctl-runtime-delete',
    needsRoot: false,
    permanentOnly: false,
    matches: [
      {
        kind: 'virtual',
        detail: 'iOS 26.1 (23B86), unused 94 days',
        bytesAllocated: 16 * GB,
        bytesApparent: 16.2 * GB,
      },
    ],
    totals: { allocated: 16 * GB, apparent: 16.2 * GB },
  },
  {
    ruleId: 'dev.node-modules',
    title: 'node_modules in 7 projects untouched 14+ days',
    category: 'dev',
    tier: 1,
    rationale: 'Installed dependencies are reproducible from each project lockfile.',
    regeneration: 'pnpm install (or npm install) in each project',
    action: 'remove-path',
    needsRoot: false,
    permanentOnly: false,
    matches: [
      {
        kind: 'dir',
        path: '~/code/acme-web/node_modules',
        detail: '~/code/acme-web (untouched 41 days)',
        bytesAllocated: 1.8 * GB,
        bytesApparent: 1.9 * GB,
      },
      {
        kind: 'dir',
        path: '~/code/acme-api/node_modules',
        detail: '~/code/acme-api (untouched 67 days)',
        bytesAllocated: 1.4 * GB,
        bytesApparent: 1.5 * GB,
      },
      {
        kind: 'dir',
        path: '~/code/marketing-site/node_modules',
        detail: '~/code/marketing-site (untouched 22 days)',
        bytesAllocated: 1.1 * GB,
        bytesApparent: 1.15 * GB,
      },
      {
        kind: 'dir',
        path: '~/code/legacy-portal/node_modules',
        detail: '~/code/legacy-portal (untouched 180 days)',
        bytesAllocated: 0.95 * GB,
        bytesApparent: 1 * GB,
      },
      {
        kind: 'dir',
        path: '~/code/design-system/node_modules',
        detail: '~/code/design-system (untouched 30 days)',
        bytesAllocated: 0.8 * GB,
        bytesApparent: 0.85 * GB,
      },
      {
        kind: 'dir',
        path: '~/code/mobile-app/node_modules',
        detail: '~/code/mobile-app (untouched 55 days)',
        bytesAllocated: 0.7 * GB,
        bytesApparent: 0.75 * GB,
      },
      {
        kind: 'dir',
        path: '~/code/data-pipeline/node_modules',
        detail: '~/code/data-pipeline (untouched 96 days)',
        bytesAllocated: 0.45 * GB,
        bytesApparent: 0.5 * GB,
      },
    ],
    totals: { allocated: 7.2 * GB, apparent: 7.65 * GB },
  },
  {
    ruleId: 'simulator.dyld-cache',
    title: 'Simulator dyld cache',
    category: 'dev',
    tier: 1,
    rationale: 'CoreSimulator rebuilds the dyld shared cache on demand the next time a simulator boots.',
    regeneration: 'Rebuilt automatically on the next simulator boot',
    action: 'remove-path',
    needsRoot: true,
    manualCommand: 'sudo rm -rf ~/Library/Developer/CoreSimulator/Caches/dyld',
    permanentOnly: false,
    matches: [
      {
        kind: 'dir',
        path: '~/Library/Developer/CoreSimulator/Caches/dyld',
        detail: 'Builds for 3 uninstalled runtimes',
        bytesAllocated: 2.3 * GB,
        bytesApparent: 2.4 * GB,
      },
    ],
    totals: { allocated: 2.3 * GB, apparent: 2.4 * GB },
  },
  {
    ruleId: 'system.swap',
    title: 'Swap files',
    category: 'system',
    tier: 3,
    rationale: 'macOS manages swap dynamically; removing it can crash or corrupt the running system.',
    regeneration: 'Not applicable — macOS recreates and sizes this itself',
    action: null,
    needsRoot: false,
    permanentOnly: false,
    matches: [
      {
        kind: 'file',
        path: '/private/var/vm/swapfile0',
        detail: 'Dynamic swap, currently 2.0 GB',
        bytesAllocated: 2 * GB,
        bytesApparent: 2 * GB,
      },
    ],
    totals: { allocated: 2 * GB, apparent: 2 * GB },
  },
];

const traps: Trap[] = [
  {
    path: '~/Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw',
    allocated: 2.7 * GB,
    apparent: 228 * GB,
    note: 'Sparse file: only 2.7 GB is allocated, and Docker grows it as images are added.',
  },
];

const unreadable: UnreadableEntry[] = [
  { path: '~/Library/Mail', code: 'EPERM' },
  { path: '~/Library/Messages', code: 'EPERM' },
];

export const sampleAudit: AuditResult = {
  schemaVersion: 1,
  generatedAt: '2026-09-17T09:30:00.000Z',
  macosVersion: '14.6',
  disk: {
    mountPoint: '/',
    volumeName: 'Macintosh HD',
    containerTotal: 494.4 * GB,
    containerUsed: 431 * GB,
    containerFree: 63.4 * GB,
    volumeUsed: 431 * GB,
    caseSensitive: false,
  },
  permissions: {
    fullDiskAccess: 'limited',
    hostApp: 'iTerm2',
    hint: 'Grant Full Disk Access to iTerm2 in System Settings → Privacy & Security → Full Disk Access, then re-run macsweep audit.',
  },
  findings,
  traps,
  unreadable,
  totals: {
    byTier: { 0: 8.4 * GB, 1: 25.5 * GB, 2: 0, 3: 2 * GB },
    reclaimable: 33.9 * GB,
  },
};

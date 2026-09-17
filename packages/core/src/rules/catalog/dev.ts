import type { Rule } from '../../types';

export const devRules: Rule[] = [
  {
    schemaVersion: 1,
    id: 'xcode.derived-data',
    title: 'Xcode DerivedData',
    category: 'dev',
    tier: 0,
    requires: ['xcode'],
    roots: ['~/Library/Developer/Xcode/DerivedData'],
    matcher: { kind: 'glob-children', root: '~/Library/Developer/Xcode/DerivedData' },
    action: 'remove-path',
    rationale:
      'DerivedData holds build intermediates, indexes and logs that Xcode recreates locally whenever a project is opened or rebuilt. It contains no source or user data, so nothing is lost by removing it.',
    regeneration:
      'Nothing to download. Xcode rebuilds the data locally on the next build, which is slower the first time.',
    preflight: { processes: ['Xcode'] },
  },
  {
    schemaVersion: 1,
    id: 'simulator.runtimes',
    title: 'Simulator runtimes',
    category: 'dev',
    tier: 1,
    requires: ['xcode'],
    roots: ['/Library/Developer/CoreSimulator'],
    matcher: { kind: 'probe', probe: 'simctl-runtimes' },
    action: 'simctl-runtime-delete',
    rationale:
      'Each iOS, watchOS, tvOS or visionOS simulator runtime is a multi-gigabyte disk image. Runtimes you no longer target can be removed with Apple’s own simctl, which keeps macOS and Xcode consistent.',
    regeneration:
      'Re-downloaded on demand from Apple (several GB per runtime) the next time Xcode needs that OS version.',
    preflight: { bootedSimulators: true },
  },
  {
    schemaVersion: 1,
    id: 'dev.node-modules',
    title: 'node_modules folders',
    category: 'dev',
    tier: 1,
    roots: ['~'],
    matcher: {
      kind: 'project-dirs',
      searchRoots: ['~'],
      name: 'node_modules',
      marker: 'package.json',
      maxAgeDays: 14,
      excludePrefixes: [
        '/opt/homebrew/lib/node_modules',
        '/usr/local/lib/node_modules',
        '~/.nvm',
        '~/.volta',
        '~/.fnm',
        '~/.npm-global',
        '~/Library',
      ],
    },
    action: 'remove-path',
    rationale:
      'Installed npm dependencies are reproducible from the project’s manifest and lockfile. Only projects with a lockfile and untouched for two weeks are offered, and global tool installs are excluded.',
    regeneration:
      'Run the package manager’s install command again; this needs network access and re-downloads the dependency tree.',
  },
];

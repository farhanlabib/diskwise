import type { Rule } from '../../types';

export const osLeftoverRules: Rule[] = [
  {
    schemaVersion: 1,
    id: 'os.installer-apps',
    title: 'macOS installer apps left in /Applications',
    category: 'os-leftovers',
    tier: 1,
    roots: ['/Applications'],
    matcher: {
      kind: 'glob-children',
      root: '/Applications',
      include: ['Install macOS *.app'],
    },
    action: 'trash-path',
    rationale:
      'A full macOS installer sitting in /Applications after an upgrade is just a re-downloadable copy; the installed system does not depend on it.',
    regeneration:
      'Re-download from the App Store or `softwareupdate --fetch-full-installer` (~13 GB).',
    minBytes: 1e9,
  },
  {
    schemaVersion: 1,
    id: 'os.install-data',
    title: '/macOS Install Data upgrade staging',
    category: 'os-leftovers',
    tier: 1,
    roots: ['/macOS Install Data'],
    matcher: { kind: 'path', path: '/macOS Install Data' },
    action: null,
    needsRoot: true,
    manualCommand: 'softwareupdate --list && sudo rm -rf "/macOS Install Data"',
    rationale:
      'Staging left by a macOS upgrade that either finished or failed; only remove it when `softwareupdate --list` shows nothing pending, or a running upgrade breaks.',
    regeneration:
      'A fresh upgrade re-creates the staging folder and re-downloads the update when you next install it.',
  },
  {
    schemaVersion: 1,
    id: 'os.library-updates',
    title: '/Library/Updates download leftovers',
    category: 'os-leftovers',
    tier: 1,
    roots: ['/Library/Updates'],
    matcher: {
      kind: 'glob-children',
      root: '/Library/Updates',
      include: ['*'],
      exclude: ['index.plist', 'ProductMetadata.plist'],
    },
    action: null,
    needsRoot: true,
    manualCommand: 'softwareupdate --list; sudo softwareupdate --clear-catalog',
    rationale:
      'Downloaded update payloads and catalog metadata left by an update that already finished; safe once `softwareupdate --list` is clean, though SIP may protect the folder.',
    regeneration:
      'macOS re-downloads the payloads the next time that update is offered.',
  },
  {
    schemaVersion: 1,
    id: 'os.relocated-items',
    title: 'Relocated Items from a macOS upgrade',
    category: 'os-leftovers',
    tier: 2,
    roots: ['/Users/Shared/Relocated Items'],
    matcher: { kind: 'path', path: '/Users/Shared/Relocated Items' },
    action: 'trash-path',
    rationale:
      'Files macOS moved aside during an upgrade because it could not keep them in place; they may be your own data, so review the contents before trashing.',
    regeneration:
      'Nothing restores them automatically — once trashed and emptied they are gone.',
  },
  {
    schemaVersion: 1,
    id: 'os.previous-system-info',
    title: 'Previous System folder',
    category: 'os-leftovers',
    tier: 3,
    roots: ['/'],
    matcher: {
      kind: 'glob-children',
      root: '/',
      include: ['Previous System*'],
    },
    action: null,
    rationale:
      'Left over from a very old in-place upgrade that moved the previous system to the disk root; it is explained only and never touched.',
    regeneration:
      'Cannot be regenerated; the old system it holds is not recoverable from anywhere else.',
  },
  {
    schemaVersion: 1,
    id: 'os.aerial-wallpapers',
    title: 'Downloaded aerial wallpaper videos',
    category: 'os-leftovers',
    tier: 3,
    roots: ['/Library/Application Support/com.apple.idleassetsd/Customer'],
    matcher: {
      kind: 'path',
      path: '/Library/Application Support/com.apple.idleassetsd/Customer',
    },
    action: null,
    manualCommand:
      'Open System Settings → Wallpaper, right-click a downloaded aerial and choose Delete',
    rationale:
      'Aerial screensaver videos downloaded by macOS; they can be several GB, but System Settings owns their lifecycle so diskwise only explains how to remove them.',
    regeneration:
      'macOS re-downloads any aerial you pick again, which costs a few GB of bandwidth.',
  },
  {
    schemaVersion: 1,
    id: 'os.orphaned-receipts',
    title: 'Installer receipts for removed packages',
    category: 'os-leftovers',
    tier: 3,
    roots: ['/private/var/db/receipts'],
    matcher: { kind: 'path', path: '/private/var/db/receipts' },
    action: null,
    manualCommand: 'pkgutil --pkgs',
    rationale:
      'Receipts for packages whose files were already removed; they are tiny and macOS still consults them, so this is report only — use `pkgutil --forget <id>` to drop a specific one.',
    regeneration:
      'A reinstalled package writes its receipt again; there is no way to rebuild a forgotten one.',
  },
  {
    schemaVersion: 1,
    id: 'os.stale-var-folders',
    title: '/private/var/folders temporary state',
    category: 'os-leftovers',
    tier: 3,
    roots: ['/private/var/folders'],
    matcher: { kind: 'path', path: '/private/var/folders' },
    action: null,
    rationale:
      'Per-user temporary state that macOS manages itself and empties at restart; deleting it while the machine runs would break running processes.',
    regeneration:
      'macOS recreates the folders on the next boot and apps rebuild their temp files as needed.',
  },
  {
    schemaVersion: 1,
    id: 'os.old-simulator-caches',
    title: 'Simulator dyld shared-cache builds',
    category: 'os-leftovers',
    tier: 0,
    roots: ['~/Library/Developer/CoreSimulator/Caches/dyld'],
    matcher: {
      kind: 'glob-children',
      root: '~/Library/Developer/CoreSimulator/Caches/dyld',
    },
    action: 'remove-path',
    preflight: { bootedSimulators: true },
    rationale:
      'Cached dyld shared-memory images for simulator runtimes; the simulator rebuilds the cache on demand, so removing them costs only time.',
    regeneration:
      'The simulator rebuilds the dyld cache automatically at the next boot of a device.',
  },
  {
    schemaVersion: 1,
    id: 'os.old-ios-device-support',
    title: 'Old iOS DeviceSupport symbols',
    category: 'os-leftovers',
    tier: 1,
    roots: ['~/Library/Developer/Xcode/iOS DeviceSupport'],
    matcher: {
      kind: 'versioned-children',
      root: '~/Library/Developer/Xcode/iOS DeviceSupport',
      keepNewest: 2,
    },
    action: 'remove-path',
    preflight: { processes: ['Xcode'] },
    rationale:
      'Debug symbols copied from each iOS version you have connected a device with; Xcode keeps one folder per version, and an old folder is only needed to debug a device that is still on that version.',
    regeneration:
      'Xcode copies the symbols again (a few minutes) the next time a device on that iOS version connects.',
  },
  {
    schemaVersion: 1,
    id: 'os.old-watchos-device-support',
    title: 'Old watchOS DeviceSupport symbols',
    category: 'os-leftovers',
    tier: 1,
    roots: ['~/Library/Developer/Xcode/watchOS DeviceSupport'],
    matcher: {
      kind: 'versioned-children',
      root: '~/Library/Developer/Xcode/watchOS DeviceSupport',
      keepNewest: 2,
    },
    action: 'remove-path',
    preflight: { processes: ['Xcode'] },
    rationale:
      'Debug symbols copied from each watchOS version you have connected a watch with; Xcode keeps one folder per version, and an old folder is only needed to debug a watch that is still on that version.',
    regeneration:
      'Xcode copies the symbols again (a few minutes) the next time a watch on that watchOS version connects.',
  },
  {
    schemaVersion: 1,
    id: 'os.old-command-line-tools-sdks',
    title: 'Superseded Command Line Tools SDKs',
    category: 'os-leftovers',
    tier: 1,
    roots: ['/Library/Developer/CommandLineTools/SDKs'],
    matcher: {
      kind: 'versioned-children',
      root: '/Library/Developer/CommandLineTools/SDKs',
      include: ['MacOSX*.sdk'],
      keepNewest: 1,
    },
    action: null,
    needsRoot: true,
    manualCommand:
      'ls /Library/Developer/CommandLineTools/SDKs && sudo rm -rf /Library/Developer/CommandLineTools/SDKs/MacOSX<old-version>.sdk',
    rationale:
      'Older macOS SDKs stay behind after Command Line Tools updates; the current SDK and the target of the MacOSX.sdk symlink are never listed, so only superseded SDKs that are no longer selected are shown.',
    regeneration:
      'Reinstall the Command Line Tools (`xcode-select --install`) to restore a removed SDK.',
  },
];

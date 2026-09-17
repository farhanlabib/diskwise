import type { Rule } from '../../types';

export const systemRules: Rule[] = [
  {
    schemaVersion: 1,
    id: 'system.swap',
    title: 'Swap and virtual-memory files',
    category: 'system',
    tier: 3,
    roots: ['/private/var/vm'],
    matcher: { kind: 'path', path: '/private/var/vm' },
    action: null,
    rationale:
      'macOS manages swap and virtual-memory here and pages to it while you work; deleting these files while the machine runs would corrupt memory state, so macsweep only reports their size.',
    regeneration:
      'macOS recreates swap files automatically as memory pressure returns after a reboot.',
  },
  {
    schemaVersion: 1,
    id: 'system.var-db',
    title: 'System databases in /private/var/db',
    category: 'system',
    tier: 3,
    roots: ['/private/var/db'],
    matcher: { kind: 'path', path: '/private/var/db' },
    action: null,
    rationale:
      'System configuration, caches and service databases that macOS reads at boot and while running; none of it is user data you can safely remove, so it is shown for size only.',
    regeneration:
      'macOS rebuilds most databases on demand, but removing them by hand can leave services broken until a reinstall or restore.',
  },
  {
    schemaVersion: 1,
    id: 'system.keychains',
    title: 'Keychains',
    category: 'system',
    tier: 3,
    roots: ['~/Library/Keychains'],
    matcher: { kind: 'path', path: '~/Library/Keychains' },
    action: null,
    rationale:
      'Your keychains hold saved passwords, certificates and encryption keys; losing them can lock you out of accounts and encrypted volumes, so macsweep never touches them.',
    regeneration:
      'Not regenerable — a keychain removed without a backup is gone, and each password would have to be re-entered by hand.',
  },
  {
    schemaVersion: 1,
    id: 'system.messages',
    title: 'Messages history',
    category: 'system',
    tier: 3,
    roots: ['~/Library/Messages'],
    matcher: { kind: 'path', path: '~/Library/Messages' },
    action: null,
    manualCommand: 'Messages → Settings → General → Keep messages',
    rationale:
      'Your iMessage and SMS history is personal data that macOS stores in this database; deleting the files behind Messages while it runs can corrupt the chat database, so messages are removed from inside the app.',
    regeneration:
      'Not recoverable once deleted — messages synced from iCloud may return, but local history does not.',
  },
  {
    schemaVersion: 1,
    id: 'system.mail',
    title: 'Mail data and message store',
    category: 'system',
    tier: 3,
    roots: ['~/Library/Mail'],
    matcher: { kind: 'path', path: '~/Library/Mail' },
    action: null,
    manualCommand: 'Mail → Settings → Accounts; or File → Export Mailbox',
    rationale:
      'Downloaded mailboxes and message attachments live here and are managed by the Mail app; deleting them behind its back risks losing local-only messages, so this is reported only.',
    regeneration:
      'IMAP and Exchange accounts re-download from the server; POP accounts and local mailboxes do not come back.',
  },
  {
    schemaVersion: 1,
    id: 'system.icloud-drive',
    title: 'iCloud Drive local storage',
    category: 'system',
    tier: 3,
    roots: ['~/Library/Mobile Documents'],
    matcher: { kind: 'path', path: '~/Library/Mobile Documents' },
    action: null,
    manualCommand: 'System Settings → Apple Account → iCloud → Optimize Mac Storage',
    rationale:
      'This is where iCloud Drive stores your documents, and many entries are cloud placeholders that take no local space and are managed by iCloud; deleting them here could remove files from every device.',
    regeneration:
      'iCloud re-downloads files on demand while you are signed in; anything removed from iCloud itself is gone everywhere.',
  },
];

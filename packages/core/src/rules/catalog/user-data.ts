import type { Rule } from '../../types';

export const userDataRules: Rule[] = [
  {
    schemaVersion: 1,
    id: 'ios.backups',
    title: 'iPhone and iPad backups',
    category: 'user-data',
    tier: 2,
    roots: ['~/Library/Application Support/MobileSync/Backup'],
    matcher: {
      kind: 'glob-children',
      root: '~/Library/Application Support/MobileSync/Backup',
    },
    action: 'trash-path',
    preflight: { processes: ['AppleMobileDeviceHelper'] },
    rationale:
      'Each local iPhone or iPad backup is your own personal data — photos, messages and app state. Moving one to the Trash frees space but takes that device copy off your Mac, so only do it when iCloud or another backup still covers the device.',
    regeneration:
      'Recoverable from the Trash until you empty it; otherwise make a fresh encrypted backup in Finder while the device is connected.',
  },
  {
    schemaVersion: 1,
    id: 'downloads.old-large',
    title: 'Old items in Downloads (90+ days)',
    category: 'user-data',
    tier: 2,
    roots: ['~/Downloads'],
    matcher: {
      kind: 'glob-children',
      root: '~/Downloads',
      exclude: ['.localized', '.DS_Store'],
      olderThanDays: 90,
    },
    action: 'trash-path',
    minBytes: 100e6,
    rationale:
      'Large items in your Downloads folder that have not changed for 90 days are usually finished downloads rather than active work, but Downloads holds personal files, so everything goes to the Trash for you to review.',
    regeneration:
      'Recoverable from the Trash until you empty it; re-download the item from its original source if you still need it.',
  },
  {
    schemaVersion: 1,
    id: 'messaging.whatsapp-media',
    title: 'WhatsApp media cache',
    category: 'user-data',
    tier: 2,
    roots: ['~/Library/Group Containers/group.net.whatsapp.WhatsApp.shared/Message/Media'],
    matcher: {
      kind: 'glob-children',
      root: '~/Library/Group Containers/group.net.whatsapp.WhatsApp.shared/Message/Media',
    },
    action: 'trash-path',
    preflight: { processes: ['WhatsApp'] },
    rationale:
      'Photos, videos and voice notes WhatsApp has cached are personal conversation data, and the local copy may be the only one on this Mac. Trashing it frees space but removes that media from your chats until it is fetched again.',
    regeneration:
      'Recoverable from the Trash until you empty it; WhatsApp can re-download the media from the sender while the message is still in the chat.',
  },
  {
    schemaVersion: 1,
    id: 'mail.downloads',
    title: 'Mail attachment downloads',
    category: 'user-data',
    tier: 2,
    roots: ['~/Library/Containers/com.apple.mail/Data/Library/Mail Downloads'],
    matcher: {
      kind: 'glob-children',
      root: '~/Library/Containers/com.apple.mail/Data/Library/Mail Downloads',
    },
    action: 'trash-path',
    preflight: { processes: ['Mail'] },
    rationale:
      'Attachments you opened in Mail are copied here and kept locally; they are personal mail content and can be the only saved copy of an attachment, so they are only ever moved to the Trash.',
    regeneration:
      'Recoverable from the Trash until you empty it, or re-download the message from the server and open the attachment again.',
  },
  {
    schemaVersion: 1,
    id: 'trash.empty',
    title: 'Empty the Trash',
    category: 'user-data',
    tier: 2,
    roots: ['~/.Trash'],
    matcher: { kind: 'path', path: '~/.Trash' },
    action: 'empty-trash',
    permanentOnly: true,
    rationale:
      'Emptying the Trash permanently deletes everything already in it and undo becomes impossible, so this is the one diskwise action that cannot be taken back.',
    regeneration: 'Nothing: emptied items are gone for good.',
  },
];

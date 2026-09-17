import type { Rule } from '../../types';

export const browserRules: Rule[] = [
  {
    schemaVersion: 1,
    id: 'browser.chrome-profiles',
    title: 'Extra Chrome profiles',
    category: 'browser',
    tier: 2,
    roots: ['~/Library/Application Support/Google/Chrome'],
    matcher: {
      kind: 'glob-children',
      root: '~/Library/Application Support/Google/Chrome',
      include: ['Profile *'],
    },
    action: 'trash-path',
    preflight: { processes: ['Google Chrome'] },
    minBytes: 200e6,
    rationale:
      'Each “Profile *” folder is a whole extra Chrome profile: its own history, passwords, extensions and cookies. Only remove profiles you no longer use, and sign in to Chrome sync with the account first so your data is backed up elsewhere — macsweep only ever moves these to the Trash.',
    regeneration:
      'Recoverable from the Trash until it is emptied; otherwise re-created empty.',
  },
  {
    schemaVersion: 1,
    id: 'browser.brave-profiles',
    title: 'Extra Brave profiles',
    category: 'browser',
    tier: 2,
    roots: ['~/Library/Application Support/BraveSoftware/Brave-Browser'],
    matcher: {
      kind: 'glob-children',
      root: '~/Library/Application Support/BraveSoftware/Brave-Browser',
      include: ['Profile *'],
    },
    action: 'trash-path',
    preflight: { processes: ['Brave Browser'] },
    minBytes: 200e6,
    rationale:
      'Each “Profile *” folder is a whole extra Brave profile: its own history, passwords, extensions and cookies. Only remove profiles you no longer use, and sign in to Brave sync with the account first so your data is backed up elsewhere — macsweep only ever moves these to the Trash.',
    regeneration:
      'Recoverable from the Trash until it is emptied; otherwise re-created empty.',
  },
];

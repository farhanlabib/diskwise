import type { AppProfile } from '../../types';

export const arcProfile: AppProfile = {
  schemaVersion: 1,
  id: 'arc',
  name: 'Arc',
  bundleIds: ['company.thebrowser.Browser'],
  caches: [
    {
      path: '~/Library/Caches/Arc',
      tier: 0,
      note: 'Rebuilt by Arc on the next launch',
    },
    {
      path: '~/Library/Caches/company.thebrowser.Browser',
      tier: 0,
      note: 'Rebuilt by Arc on the next launch',
    },
  ],
  protect: ['~/Library/Application Support/Arc/User Data'],
  rationale:
    'These two folders are Arc’s Chromium caches of web pages and compiled scripts. Your spaces, tabs, history, passwords and cookies live under User Data, which is protected and never offered.',
  regeneration:
    'Nothing to download. Arc rebuilds the caches as you browse, which is slower until it refills them.',
};

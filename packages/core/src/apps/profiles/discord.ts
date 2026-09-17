import type { AppProfile } from '../../types';

export const discordProfile: AppProfile = {
  schemaVersion: 1,
  id: 'discord',
  name: 'Discord',
  bundleIds: ['com.hnc.Discord'],
  caches: [
    {
      path: '~/Library/Application Support/discord/Cache',
      tier: 0,
      note: 'Downloaded images, emoji and UI assets',
    },
    {
      path: '~/Library/Application Support/discord/Code Cache',
      tier: 0,
      note: 'Compiled JavaScript for the Electron client',
    },
    {
      path: '~/Library/Application Support/discord/GPUCache',
      tier: 0,
      note: 'GPU shader cache; rebuilt on launch',
    },
  ],
  rationale:
    'Discord is an Electron app and keeps only downloaded UI assets, emoji and images in these cache folders. No messages or account data live there.',
  regeneration: 'Re-downloaded from Discord on the next launch.',
};

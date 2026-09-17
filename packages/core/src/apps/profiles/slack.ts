import type { AppProfile } from '../../types';

export const slackProfile: AppProfile = {
  schemaVersion: 1,
  id: 'slack',
  name: 'Slack',
  bundleIds: ['com.tinyspeck.slackmacgap'],
  caches: [
    {
      path: '~/Library/Application Support/Slack/Service Worker/CacheStorage',
      tier: 0,
      note: 'Cached web assets the Slack client rebuilds on launch',
    },
    {
      path: '~/Library/Containers/com.tinyspeck.slackmacgap/Data/Library/Application Support/Slack/Cache',
      tier: 0,
      note: 'Sandboxed cache of downloaded files, images and avatars',
    },
    {
      path: '~/Library/Containers/com.tinyspeck.slackmacgap/Data/Library/Application Support/Slack/Service Worker/CacheStorage',
      tier: 0,
      note: 'Sandboxed service worker assets',
    },
  ],
  rationale:
    'Slack is an Electron app. These folders hold downloaded UI assets and attachments, not messages or account data, and Slack rebuilds them from its servers on the next launch.',
  regeneration:
    'Re-downloaded from Slack on the next launch; no sign-in needed.',
};

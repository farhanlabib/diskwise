import type { AppProfile } from '../../types';

export const safariProfile: AppProfile = {
  schemaVersion: 1,
  id: 'safari',
  name: 'Safari',
  bundleIds: ['com.apple.Safari'],
  caches: [
    {
      path: '~/Library/Caches/com.apple.Safari',
      tier: 0,
      note: 'Web content caches; rebuilt as you browse',
    },
    {
      path: '~/Library/Containers/com.apple.Safari/Data/Library/Caches',
      tier: 0,
      note: 'Sandboxed web caches; rebuilt as you browse',
    },
  ],
  protect: ['~/Library/Safari'],
  rationale:
    'These two folders are Safari’s caches of web pages, images and compiled scripts, which Safari rebuilds as you browse. Your history, bookmarks, reading list and website data live in ~/Library/Safari, which is protected.',
  regeneration:
    'Nothing to download. Safari rebuilds the caches as you browse, which is slower until they refill.',
};

import type { AppProfile } from '../../types';

export const firefoxProfile: AppProfile = {
  schemaVersion: 1,
  id: 'firefox',
  name: 'Firefox',
  bundleIds: ['org.mozilla.firefox'],
  caches: [
    {
      path: '~/Library/Caches/Firefox',
      tier: 0,
      note: 'Web and startup caches; rebuilt as Firefox runs',
    },
  ],
  protect: ['~/Library/Application Support/Firefox/Profiles'],
  rationale:
    'Firefox caches web content and startup data in ~/Library/Caches/Firefox and rebuilds it by itself. Your history, bookmarks, passwords and extensions live in the profile folders under Application Support/Firefox/Profiles, which are protected.',
  regeneration:
    'Nothing to download. Firefox rebuilds the caches as you browse, which is slower until they refill.',
};

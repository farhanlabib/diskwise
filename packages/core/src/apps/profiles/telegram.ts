import type { AppProfile } from '../../types';

export const telegramProfile: AppProfile = {
  schemaVersion: 1,
  id: 'telegram',
  name: 'Telegram',
  bundleIds: ['ru.keepcoder.Telegram', 'org.telegram.desktop'],
  caches: [
    {
      path: '~/Library/Caches/ru.keepcoder.Telegram',
      tier: 0,
      note: 'Rebuilt by Telegram on the next launch',
    },
  ],
  protect: ['~/Library/Group Containers/6N38VWS5BX.ru.keepcoder.Telegram'],
  rationale:
    'Telegram keeps your messages, media and account data in its group container, which is protected and never offered. Its downloaded media caches live per account under that container and are managed from Telegram → Settings → Data and Storage, so diskwise does not touch them; only the app-level cache folder is listed here.',
  regeneration:
    'Nothing to download. Telegram rebuilds its cache folder on the next launch; removed media is fetched again only if you still have the chat open.',
};

import type { AppProfile } from '../../types';

export const jetbrainsProfile: AppProfile = {
  schemaVersion: 1,
  id: 'jetbrains',
  name: 'JetBrains IDEs',
  bundleIds: [
    'com.jetbrains.intellij',
    'com.jetbrains.intellij.ce',
    'com.jetbrains.WebStorm',
    'com.jetbrains.pycharm',
    'com.jetbrains.pycharm.ce',
    'com.google.android.studio',
    'com.jetbrains.goland',
    'com.jetbrains.rider',
  ],
  caches: [
    {
      path: '~/Library/Caches/JetBrains',
      tier: 0,
      note: 'Indexes and local history caches; the IDE re-indexes on next open',
    },
  ],
  protect: ['~/Library/Application Support/JetBrains'],
  rationale:
    'JetBrains IDEs keep only indexes and local history in ~/Library/Caches/JetBrains, which each IDE rebuilds by re-indexing the projects it opens. Your projects, settings and plugins live under ~/Library/Application Support/JetBrains, which is protected. Android Studio keeps its caches under ~/Library/Caches/Google/AndroidStudio*, but that is a glob and macsweep profiles list exact paths, so it is deliberately left out; Android Studio re-indexes the same way if you clear that folder by hand.',
  regeneration:
    'Nothing to download. Each IDE re-indexes the projects you open, which is slower the first time until the caches refill.',
};

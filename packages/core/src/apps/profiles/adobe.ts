import type { AppProfile } from '../../types';

export const adobeProfile: AppProfile = {
  schemaVersion: 1,
  id: 'adobe',
  name: 'Adobe Creative Cloud video apps',
  bundleIds: [
    'com.adobe.PremierePro.24',
    'com.adobe.PremierePro.25',
    'com.adobe.AfterEffects',
    'com.adobe.Photoshop',
  ],
  caches: [
    {
      path: '~/Library/Application Support/Adobe/Common/Media Cache Files',
      tier: 1,
      note: 'Conformed audio and preview files; Premiere and After Effects rebuild them, which takes time',
    },
    {
      path: '~/Library/Application Support/Adobe/Common/Media Cache',
      tier: 1,
      note: 'Media cache database; rebuilt as clips are re-imported',
    },
  ],
  protect: ['~/Library/Application Support/Adobe/Common/Team Projects Local Hub'],
  rationale:
    'These two shared folders hold conformed audio and preview renders that Premiere Pro and After Effects regenerate from your project media. Your projects, sequences and presets are not here, and Team Projects data lives under Team Projects Local Hub, which is protected. Because regenerating the caches means re-conforming the footage, this is tier 1 rather than a free rebuild.',
  regeneration:
    'Premiere Pro and After Effects rebuild the caches as they open and play back your projects; this takes time and reads the original media again.',
};

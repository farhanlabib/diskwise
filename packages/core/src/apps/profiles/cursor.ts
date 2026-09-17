import type { AppProfile } from '../../types';

export const cursorProfile: AppProfile = {
  schemaVersion: 1,
  id: 'cursor',
  name: 'Cursor',
  bundleIds: ['com.todesktop.230313mzl4w4u92'],
  caches: [
    {
      path: '~/Library/Application Support/Cursor/CachedExtensionVSIXs',
      tier: 1,
      note: 'Downloaded extension packages',
    },
  ],
  protect: ['~/Library/Application Support/Cursor/User/workspaceStorage'],
  rationale:
    'Cursor keeps downloaded extension packages in this folder. Extensions, settings and workspace files live elsewhere and are protected, so clearing it only costs a re-download.',
  regeneration: 'Extension packages re-download when you install or update an extension.',
};

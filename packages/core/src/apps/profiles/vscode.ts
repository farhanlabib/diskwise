import type { AppProfile } from '../../types';

export const vscodeProfile: AppProfile = {
  schemaVersion: 1,
  id: 'vscode',
  name: 'Visual Studio Code',
  bundleIds: ['com.microsoft.VSCode'],
  caches: [
    {
      path: '~/Library/Application Support/Code/CachedExtensionVSIXs',
      tier: 1,
      note: 'Downloaded extension packages',
    },
    {
      path: '~/Library/Caches/com.microsoft.VSCode.ShipIt',
      tier: 1,
      note: 'Downloaded app updates',
    },
  ],
  protect: ['~/Library/Application Support/Code/User/workspaceStorage'],
  rationale:
    'VS Code keeps downloaded extension packages and app-update payloads in these folders. Your extensions, settings and workspace files live elsewhere and are protected, so clearing these only costs a re-download.',
  regeneration:
    'Extension packages re-download when you install or update an extension; app updates re-download from Microsoft.',
};

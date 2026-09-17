import type { Rule } from '../../types';

export const simulatorRules: Rule[] = [
  {
    schemaVersion: 1,
    id: 'simulator.devices-unavailable',
    title: 'Unavailable simulator devices',
    category: 'dev',
    tier: 1,
    requires: ['xcode'],
    roots: ['~/Library/Developer/CoreSimulator/Devices'],
    matcher: { kind: 'probe', probe: 'simctl-devices' },
    action: 'simctl-device-delete-unavailable',
    rationale:
      'A device marked unavailable belongs to a runtime that was deleted or is otherwise unusable; simctl cannot boot it, so it only holds a data folder. Apple’s own `simctl delete unavailable` removes them cleanly.',
    regeneration:
      'Recreate a device in Xcode or with `simctl create`; its previous app data is not restored.',
  },
];

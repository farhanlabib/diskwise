import type { Candidate } from '../../types';

interface RawDevice {
  udid?: string;
  name?: string;
  state?: string;
  isAvailable?: boolean;
  dataPathSize?: number;
}

interface RawDevices {
  devices?: Record<string, RawDevice[]>;
}

// 'com.apple.CoreSimulator.SimRuntime.iOS-17-4' -> 'iOS 17.4'
function runtimeShortName(runtimeId: string): string {
  const last = runtimeId.split('.').pop() ?? runtimeId;
  const parts = last.split('-');
  if (parts.length <= 1) return last;
  return `${parts[0]} ${parts.slice(1).join('.')}`;
}

export function parseUnavailableDevices(json: string): Candidate[] {
  const parsed = JSON.parse(json) as RawDevices;
  const candidates: Candidate[] = [];

  for (const [runtimeId, devices] of Object.entries(parsed.devices ?? {})) {
    if (!Array.isArray(devices)) continue;
    const runtime = runtimeShortName(runtimeId);
    for (const device of devices) {
      if (device === null || typeof device !== 'object') continue;
      if (device.isAvailable !== false) continue;
      const size = typeof device.dataPathSize === 'number' ? device.dataPathSize : 0;
      candidates.push({
        kind: 'virtual',
        detail: `${device.name ?? '<unnamed>'} (${runtime})`,
        actionArgs: { udid: device.udid ?? '' },
        bytesHint: { allocated: size, apparent: size },
      });
    }
  }

  return candidates;
}

// The action deletes every unavailable device at once, so the matcher reports
// one aggregate candidate instead of one per device.
export function aggregateUnavailableDevices(candidates: Candidate[]): Candidate[] {
  if (candidates.length === 0) return [];
  const bytes = candidates.reduce((sum, c) => sum + (c.bytesHint?.allocated ?? 0), 0);
  return [
    {
      kind: 'virtual',
      detail: `${candidates.length} unavailable simulator devices`,
      bytesHint: { allocated: bytes, apparent: bytes },
    },
  ];
}

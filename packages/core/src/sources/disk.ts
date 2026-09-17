import type { DiskInfo, ProbeRunner } from '../types';
import { parsePlist } from '../probes/plist';
import { runProbe } from '../probes/run';

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export async function getDiskInfo(run: ProbeRunner = runProbe, mount = '/'): Promise<DiskInfo> {
  const result = await run('diskutil', ['info', '-plist', mount]);
  if (result.exitCode !== 0) {
    throw new Error(
      `diskutil info -plist ${mount} failed with exit code ${result.exitCode}: ${result.stderr.trim()}`,
    );
  }

  const parsed = parsePlist(result.stdout);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`diskutil info -plist ${mount} did not return a plist dictionary`);
  }
  const dict = parsed as Record<string, unknown>;

  const containerTotal = asNumber(dict['APFSContainerSize']) ?? 0;
  const containerFree = asNumber(dict['APFSContainerFree']) ?? 0;
  const containerUsed = containerTotal - containerFree;
  const volumeUsed = asNumber(dict['CapacityInUse']) ?? asNumber(dict['VolumeUsedSpace']) ?? 0;

  const filesystemType = asString(dict['FilesystemType']) ?? '';
  const filesystemName = asString(dict['FilesystemUserVisibleName']) ?? '';
  const caseSensitive = /case-sensitive/i.test(filesystemType) || /case-sensitive/i.test(filesystemName);

  return {
    mountPoint: asString(dict['MountPoint']) ?? mount,
    volumeName: asString(dict['VolumeName']) ?? '',
    containerTotal,
    containerUsed,
    containerFree,
    volumeUsed,
    caseSensitive,
  };
}

import { describe, expect, it } from 'vitest';
import { Command } from 'commander';
import type { DiskInfo, PermissionStatus } from '@diskwise/core/types';
import type { ToolInfo } from '@diskwise/core';
import type { IO } from '../program';
import { registerDoctorCommand, type DoctorDeps } from './doctor';

const disk: DiskInfo = {
  mountPoint: '/',
  volumeName: 'Macintosh HD',
  containerTotal: 1_000_000_000_000,
  containerUsed: 400_000_000_000,
  containerFree: 600_000_000_000,
  volumeUsed: 400_000_000_000,
  caseSensitive: false,
};

const tools: ToolInfo[] = [
  { id: 'xcode', label: 'Xcode', path: '/Applications/Xcode.app', version: '16.0' },
  { id: 'docker', label: 'Docker' },
];

function harness(deps: DoctorDeps) {
  const out: string[] = [];
  const err: string[] = [];
  const io: IO = { stdout: (s) => out.push(s), stderr: (s) => err.push(s), isTTY: false };
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeOut: (s) => out.push(s), writeErr: (s) => err.push(s) });
  registerDoctorCommand(program, io, deps);
  return { out, err, run: (argv: string[]) => program.parseAsync(['node', 'diskwise', ...argv]) };
}

function fakedDeps(overrides: DoctorDeps = {}): DoctorDeps {
  return {
    macos: async () => '15.1',
    disk: async () => disk,
    permissions: async () => ({ fullDiskAccess: 'granted', hostApp: 'Droppy Code' }),
    helper: async () => ({ path: '/opt/diskwise-helper', version: '1.0.0' }),
    tools: async () => tools,
    ...overrides,
  };
}

describe('doctor command', () => {
  it('prints every section as text', async () => {
    const { out, run } = harness(fakedDeps());
    await run(['doctor']);
    const text = out.join('');

    expect(text).toContain('macOS 15.1');
    expect(text).toContain('Disk (Macintosh HD): 1.0 TB total · 400.0 GB used · 600.0 GB free');
    expect(text).toContain('Full Disk Access: granted');
    expect(text).toContain('Host app: Droppy Code');
    expect(text).toContain('Native helper: /opt/diskwise-helper (1.0.0)');
    expect(text).toContain('Xcode');
    expect(text).toContain('16.0');
    expect(text).toContain('Docker');
    expect(text).toContain('not installed');
  });

  it('prints the hint and host app when access is limited', async () => {
    const permissions: PermissionStatus = {
      fullDiskAccess: 'limited',
      hostApp: 'Droppy Code',
      hint: 'Grant Full Disk Access to Droppy Code in System Settings → Privacy & Security → Full Disk Access, then quit and reopen Droppy Code.',
    };
    const { out, run } = harness(fakedDeps({ permissions: async () => permissions }));
    await run(['doctor']);
    const text = out.join('');

    expect(text).toContain('Full Disk Access: limited');
    expect(text).toContain('quit and reopen Droppy Code');
  });

  it('tells the user to build the helper when it is missing', async () => {
    const { out, run } = harness(fakedDeps({ helper: async () => ({}) }));
    await run(['doctor']);
    expect(out.join('')).toContain('not built: run packages/native-helper/build.sh');
  });

  it('prints one JSON object with --json', async () => {
    const { out, run } = harness(fakedDeps());
    await run(['doctor', '--json']);

    const parsed = JSON.parse(out.join('')) as {
      macos: string;
      disk: DiskInfo;
      permissions: PermissionStatus;
      helper: { path?: string; version?: string };
      tools: ToolInfo[];
    };
    expect(parsed.macos).toBe('15.1');
    expect(parsed.disk.volumeName).toBe('Macintosh HD');
    expect(parsed.permissions.fullDiskAccess).toBe('granted');
    expect(parsed.helper.path).toBe('/opt/diskwise-helper');
    expect(parsed.tools).toEqual(tools);
  });

  it('still exits 0 when a probe throws', async () => {
    const { out, run } = harness(
      fakedDeps({
        macos: async () => {
          throw new Error('no sw_vers');
        },
        disk: async () => {
          throw new Error('no diskutil');
        },
      }),
    );
    await run(['doctor']);
    const text = out.join('');
    expect(text).toContain('macOS version: unknown');
    expect(text).toContain('Disk: unavailable');
    expect(text).toContain('Full Disk Access: granted');
  });
});

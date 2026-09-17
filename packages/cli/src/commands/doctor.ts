import { homedir } from 'node:os';
import { Command } from 'commander';
import { formatBytes } from '@macsweep/report';
import { checkFullDiskAccess, getDiskInfo, native, runProbe } from '@macsweep/core';
import type { DiskInfo, PermissionStatus, ProbeRunner } from '@macsweep/core/types';
import { detectTools, type ToolInfo } from '../../../core/src/sources/tools';
import type { IO } from '../program';

export interface DoctorDeps {
  tools?: () => Promise<ToolInfo[]>;
  permissions?: () => Promise<PermissionStatus>;
  helper?: () => Promise<{ path?: string; version?: string }>;
  disk?: () => Promise<DiskInfo | undefined>;
  macos?: () => Promise<string | undefined>;
}

interface DoctorReport {
  macos?: string;
  disk?: DiskInfo;
  permissions: PermissionStatus;
  helper: { path?: string; version?: string };
  tools: ToolInfo[];
}

const HELPER_MISSING = 'not built: run packages/native-helper/build.sh';
const TIMEOUT_MS = 5000;
const VERSION = /\d+\.\d+(\.\d+)?/;

async function readMacosVersion(run: ProbeRunner): Promise<string | undefined> {
  const result = await run('sw_vers', ['-productVersion'], { timeoutMs: TIMEOUT_MS });
  return result.exitCode === 0 ? result.stdout.trim() || undefined : undefined;
}

async function findHelperInfo(): Promise<{ path?: string; version?: string }> {
  const path = await native.findHelper();
  if (!path) return {};
  const result = await runProbe(path, ['version'], { timeoutMs: TIMEOUT_MS });
  const version = VERSION.exec(result.stdout + result.stderr)?.[0];
  return version ? { path, version } : { path };
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

function formatText(report: DoctorReport): string {
  const lines: string[] = [];

  lines.push(report.macos ? `macOS ${report.macos}` : 'macOS version: unknown');

  if (report.disk) {
    lines.push(
      `Disk (${report.disk.volumeName || report.disk.mountPoint}): ${formatBytes(report.disk.containerTotal)} total · ${formatBytes(report.disk.containerUsed)} used · ${formatBytes(report.disk.containerFree)} free`,
    );
  } else {
    lines.push('Disk: unavailable');
  }

  lines.push(`Full Disk Access: ${report.permissions.fullDiskAccess}`);
  if (report.permissions.hostApp) lines.push(`  Host app: ${report.permissions.hostApp}`);
  if (report.permissions.hint) lines.push(`  ${report.permissions.hint}`);

  lines.push(
    report.helper.path
      ? `Native helper: ${report.helper.path}${report.helper.version ? ` (${report.helper.version})` : ''}`
      : `Native helper: ${HELPER_MISSING}`,
  );

  lines.push('Tools:');
  const width = Math.max('TOOL'.length, ...report.tools.map((tool) => tool.label.length));
  for (const tool of report.tools) {
    lines.push(`  ${tool.label.padEnd(width)}  ${tool.version ?? 'not installed'}`);
  }

  return `${lines.join('\n')}\n`;
}

export function registerDoctorCommand(program: Command, io: IO, deps: DoctorDeps = {}): void {
  const tools = deps.tools ?? (() => detectTools());
  const permissions = deps.permissions ?? (() => checkFullDiskAccess(homedir()));
  const helper = deps.helper ?? findHelperInfo;
  const disk = deps.disk ?? (() => getDiskInfo(runProbe));
  const macos = deps.macos ?? (() => readMacosVersion(runProbe));

  program
    .command('doctor')
    .description('Report host app, Full Disk Access and the tools macsweep can use')
    .option('--json', 'print the report as JSON')
    .action(async (options: { json?: boolean }) => {
      const [macosVersion, diskInfo, permissionStatus, helperInfo, toolList] = await Promise.all([
        safe(macos, undefined),
        safe(disk, undefined),
        safe(permissions, { fullDiskAccess: 'unknown' }),
        safe(helper, {}),
        safe(tools, []),
      ]);

      const report: DoctorReport = {
        ...(macosVersion !== undefined ? { macos: macosVersion } : {}),
        ...(diskInfo !== undefined ? { disk: diskInfo } : {}),
        permissions: permissionStatus,
        helper: helperInfo,
        tools: toolList,
      };

      io.stdout(
        options.json === true ? `${JSON.stringify(report, null, 2)}\n` : formatText(report),
      );
    });
}

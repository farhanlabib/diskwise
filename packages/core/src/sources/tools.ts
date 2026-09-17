import type { ProbeRunner } from '../types';
import { resolveBin } from '../probes/bin-resolver';
import { runProbe } from '../probes/run';

export interface ToolInfo {
  id: string;
  label: string;
  path?: string;
  version?: string;
}

const VERSION = /\d+\.\d+(\.\d+)?/;
const TIMEOUT_MS = 5000;

interface ToolSpec {
  id: string;
  label: string;
  bin: string;
  versionArgs: string[];
  // When set, the reported path comes from this command instead of the resolved
  // binary itself (xcode-select points at the Xcode developer directory).
  pathFrom?: { bin: string; args: string[] };
}

const SPECS: ToolSpec[] = [
  {
    id: 'xcode',
    label: 'Xcode',
    bin: 'xcodebuild',
    versionArgs: ['-version'],
    pathFrom: { bin: 'xcode-select', args: ['-p'] },
  },
  { id: 'docker', label: 'Docker', bin: 'docker', versionArgs: ['--version'] },
  { id: 'homebrew', label: 'Homebrew', bin: 'brew', versionArgs: ['--version'] },
  { id: 'node', label: 'Node.js', bin: 'node', versionArgs: ['--version'] },
  { id: 'pnpm', label: 'pnpm', bin: 'pnpm', versionArgs: ['--version'] },
  { id: 'yarn', label: 'Yarn', bin: 'yarn', versionArgs: ['--version'] },
  { id: 'uv', label: 'uv', bin: 'uv', versionArgs: ['--version'] },
  { id: 'go', label: 'Go', bin: 'go', versionArgs: ['version'] },
  { id: 'python', label: 'Python', bin: 'python3', versionArgs: ['--version'] },
  { id: 'rust', label: 'Rust', bin: 'cargo', versionArgs: ['--version'] },
  { id: 'cocoapods', label: 'CocoaPods', bin: 'pod', versionArgs: ['--version'] },
];

function firstVersion(text: string): string | undefined {
  for (const line of text.split('\n')) {
    const match = VERSION.exec(line);
    if (match) return match[0];
  }
  return undefined;
}

async function detectTool(
  spec: ToolSpec,
  run: ProbeRunner,
  home: string | undefined,
): Promise<ToolInfo> {
  const info: ToolInfo = { id: spec.id, label: spec.label };

  let versionBin: string | null;
  let path: string | undefined;

  if (spec.pathFrom) {
    const pathBin = await resolveBin(spec.pathFrom.bin, { run, home });
    if (!pathBin) return info;
    const result = await run(pathBin, spec.pathFrom.args, { timeoutMs: TIMEOUT_MS });
    if (result.exitCode !== 0) return info;
    path = result.stdout.trim() || undefined;
    if (path === undefined) return info;
    versionBin = await resolveBin(spec.bin, { run, home });
  } else {
    versionBin = await resolveBin(spec.bin, { run, home });
    if (!versionBin) return info;
    path = versionBin;
  }

  info.path = path;
  if (!versionBin) return info;

  const result = await run(versionBin, spec.versionArgs, { timeoutMs: TIMEOUT_MS });
  const version = firstVersion(result.stdout + result.stderr);
  if (version !== undefined) info.version = version;
  return info;
}

export async function detectTools(
  opts: { run?: ProbeRunner; home?: string } = {},
): Promise<ToolInfo[]> {
  const run = opts.run ?? runProbe;
  return Promise.all(SPECS.map((spec) => detectTool(spec, run, opts.home)));
}

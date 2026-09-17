import type { ProbeRunner } from '../types';
import { runProbe } from '../probes/run';

// TERM_PROGRAM is only set when the shell's parent is a terminal emulator, and
// it is empty for GUI apps that spawn a shell (e.g. Droppy Code), so it is a
// weaker signal than walking the process tree for the .app bundle.
const TERM_PROGRAM_NAMES: Record<string, string> = {
  Apple_Terminal: 'Terminal',
  'iTerm.app': 'iTerm2',
  vscode: 'Visual Studio Code',
  WarpTerminal: 'Warp',
  ghostty: 'Ghostty',
};

const APP_MARKER = '.app/Contents/MacOS/';
const APP_SUFFIX = '.app';

export function hostAppFromTermProgram(v?: string): string | undefined {
  if (!v) return undefined;
  return TERM_PROGRAM_NAMES[v] ?? v;
}

function appFromCommand(command: string): { name: string; path: string } | undefined {
  const index = command.indexOf(APP_MARKER);
  if (index === -1) return undefined;
  const appPath = command.slice(0, index + APP_SUFFIX.length);
  const base = appPath.split('/').pop();
  if (!base || !base.endsWith(APP_SUFFIX)) return undefined;
  return { name: base.slice(0, -APP_SUFFIX.length), path: appPath };
}

export async function detectHostApp(
  opts: { run?: ProbeRunner; pid?: number; maxDepth?: number } = {},
): Promise<{ name: string; path: string } | undefined> {
  const run = opts.run ?? runProbe;
  const maxDepth = opts.maxDepth ?? 20;
  let pid = opts.pid ?? process.pid;

  for (let depth = 0; depth < maxDepth; depth += 1) {
    const result = await run('ps', ['-o', 'ppid=,comm=', '-p', String(pid)]);
    if (result.exitCode !== 0) return undefined;

    const match = /^(\d+)\s+(.+)$/.exec(result.stdout.trim());
    if (!match) return undefined;

    const ppid = Number(match[1]);
    const command = match[2]!.trim();

    const app = appFromCommand(command);
    if (app) return app;

    if (ppid <= 1) return undefined;
    pid = ppid;
  }

  return undefined;
}

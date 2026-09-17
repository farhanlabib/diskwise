import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProbeRunner } from '../types';
import { detectTools } from './tools';

// resolveBin reaches into the real filesystem and the user's shell, so stub it
// and drive the version probes with a fake runner instead.
const hoisted = vi.hoisted(() => ({ installed: new Set<string>() }));
vi.mock('../probes/bin-resolver', () => ({
  resolveBin: async (name: string) => (hoisted.installed.has(name) ? `/fake/bin/${name}` : null),
}));

afterEach(() => {
  hoisted.installed.clear();
});

function makeRun(versions: Record<string, string>) {
  return vi.fn(async (bin: string, args: string[]) => {
    const key = `${bin.split('/').pop()} ${args.join(' ')}`;
    const stdout = versions[key];
    if (stdout === undefined) return { stdout: '', stderr: 'not found', exitCode: 1 };
    return { stdout, stderr: '', exitCode: 0 };
  });
}

function byId(tools: Awaited<ReturnType<typeof detectTools>>, id: string) {
  return tools.find((tool) => tool.id === id)!;
}

describe('detectTools', () => {
  it('returns every known tool in order, with id and label always present', async () => {
    const tools = await detectTools({ run: makeRun({}) });
    expect(tools.map((tool) => tool.id)).toEqual([
      'xcode',
      'docker',
      'homebrew',
      'node',
      'pnpm',
      'yarn',
      'uv',
      'go',
      'python',
      'rust',
      'cocoapods',
    ]);
    for (const tool of tools) {
      expect(tool.label.length).toBeGreaterThan(0);
    }
  });

  it('reports path and version for installed tools and only id/label for missing ones', async () => {
    hoisted.installed.add('node');
    const run = makeRun({ 'node --version': 'v20.11.1\n' });

    const tools = await detectTools({ run });

    expect(byId(tools, 'node')).toEqual({
      id: 'node',
      label: 'Node.js',
      path: '/fake/bin/node',
      version: '20.11.1',
    });
    expect(byId(tools, 'docker')).toEqual({ id: 'docker', label: 'Docker' });
    expect(run).toHaveBeenCalledWith('/fake/bin/node', ['--version'], { timeoutMs: 5000 });
  });

  it('extracts the version pattern, not the whole line', async () => {
    hoisted.installed.add('docker');
    hoisted.installed.add('go');
    const run = makeRun({
      'docker --version': 'Docker version 27.0.3, build 7d4bcd8\n',
      'go version': 'go version go1.22.5 darwin/arm64\n',
    });

    const tools = await detectTools({ run });

    expect(byId(tools, 'docker').version).toBe('27.0.3');
    expect(byId(tools, 'go').version).toBe('1.22.5');
  });

  it('reads a version printed to stderr', async () => {
    hoisted.installed.add('cargo');
    const run: ProbeRunner = async () => ({
      stdout: '',
      stderr: 'cargo 1.79.0 (129f3b996 2024-06-10)\n',
      exitCode: 0,
    });

    const tools = await detectTools({ run });

    expect(byId(tools, 'rust')).toEqual({
      id: 'rust',
      label: 'Rust',
      path: '/fake/bin/cargo',
      version: '1.79.0',
    });
  });

  it('uses xcode-select for the path and xcodebuild for the version', async () => {
    hoisted.installed.add('xcode-select');
    hoisted.installed.add('xcodebuild');
    const run = makeRun({
      'xcode-select -p': '/Applications/Xcode.app/Contents/Developer\n',
      'xcodebuild -version': 'Xcode 16.0\nBuild version 16A242d\n',
    });

    const tools = await detectTools({ run });

    expect(byId(tools, 'xcode')).toEqual({
      id: 'xcode',
      label: 'Xcode',
      path: '/Applications/Xcode.app/Contents/Developer',
      version: '16.0',
    });
  });

  it('drops a tool whose path command fails', async () => {
    hoisted.installed.add('xcode-select');
    const run = makeRun({});

    const tools = await detectTools({ run });

    expect(byId(tools, 'xcode')).toEqual({ id: 'xcode', label: 'Xcode' });
  });

  it('probes tools in parallel', async () => {
    for (const name of [
      'xcode-select',
      'xcodebuild',
      'docker',
      'brew',
      'node',
      'pnpm',
      'yarn',
      'uv',
      'go',
      'python3',
      'cargo',
      'pod',
    ]) {
      hoisted.installed.add(name);
    }

    let inFlight = 0;
    let peak = 0;
    const run: ProbeRunner = async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return { stdout: '1.2.3\n', stderr: '', exitCode: 0 };
    };

    const tools = await detectTools({ run });

    expect(peak).toBeGreaterThan(1);
    expect(tools.every((tool) => tool.version === '1.2.3')).toBe(true);
  });
});

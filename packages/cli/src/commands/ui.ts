import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { startServer } from '@macsweep/server';
import type { ServerHandle } from '@macsweep/server';
import { createServerEngine } from '../server-engine';
import type { IO } from '../program';

async function resolveAssetsDir(): Promise<string | undefined> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.join(here, 'ui'), path.resolve(here, '../../ui/dist')];
  for (const candidate of candidates) {
    try {
      await access(path.join(candidate, 'index.html'));
      return candidate;
    } catch {
      // try the next candidate
    }
  }
  return undefined;
}

function openInBrowser(url: string): Promise<void> {
  return new Promise((resolveOpen, rejectOpen) => {
    // execFile, never a shell: the tokenized url is passed verbatim.
    execFile('open', [url], (error) => {
      if (error) rejectOpen(error);
      else resolveOpen();
    });
  });
}

export function registerUiCommand(
  program: Command,
  io: IO,
  deps: {
    start?: typeof startServer;
    open?: (url: string) => Promise<void>;
  } = {},
): void {
  const start = deps.start ?? startServer;
  const open = deps.open ?? openInBrowser;

  program
    .command('ui')
    .description('Start the local web UI')
    .option('--port <n>', 'port to listen on (1024-65535, or 0 for a random port)')
    .option('--no-open', 'do not open the browser')
    .action(async (options: { port?: string; open?: boolean }) => {
      let port: number | undefined;
      if (options.port !== undefined) {
        const parsed = Number(options.port);
        if (
          !Number.isInteger(parsed) ||
          parsed < 0 ||
          parsed > 65535 ||
          (parsed !== 0 && parsed < 1024)
        ) {
          program.error(`invalid port "${options.port}" (expected 0 or 1024-65535)`, {
            exitCode: 2,
          });
        }
        port = parsed;
      }

      const assetsDir = await resolveAssetsDir();
      if (!assetsDir) {
        program.error('The web UI is not built. Run: pnpm -F @macsweep/ui build', { exitCode: 1 });
      }

      let resolveClosed: () => void = () => {};
      const closed = new Promise<void>((resolve) => {
        resolveClosed = resolve;
      });

      const handle: ServerHandle = await start({
        engine: createServerEngine(),
        assetsDir,
        ...(port !== undefined ? { port } : {}),
        onClose: () => resolveClosed(),
      });

      const base = handle.url.split('#')[0] ?? handle.url;
      io.stdout(`MacSweep is running at ${base}\n`);
      io.stdout('Press Ctrl-C to stop.\n');

      const onSigint = (): void => {
        void handle.close();
      };
      process.once('SIGINT', onSigint);
      try {
        if (options.open === false) {
          io.stdout(`${handle.url}\n`);
        } else {
          await open(handle.url);
        }
        await closed;
      } finally {
        process.removeListener('SIGINT', onSigint);
        await handle.close();
      }
    });
}

import fs from 'node:fs/promises';
import { join } from 'node:path';

import { resolveBin } from '../probes/bin-resolver';
import type { PlanItem, ProbeRunner } from '../types';

export type ActionContext = {
  home: string;
  run: ProbeRunner;
  trash: (p: string) => Promise<{ trashedPath: string }>;
};

export interface ActionResult {
  trashedPath?: string;
  restorable: boolean;
}

const UUID_RE = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;

function requirePath(item: PlanItem): string {
  const target = item.match.path;
  if (!target) throw new Error('match has no path');
  return target;
}

function firstLine(text: string): string {
  const line = text.split('\n').find((l) => l.trim().length > 0);
  return line?.trim() ?? '';
}

async function runCommand(ctx: ActionContext, bin: string, args: string[]): Promise<void> {
  const resolved = await resolveBin(bin, { home: ctx.home, run: ctx.run });
  if (!resolved) throw new Error(`${bin} not found`);

  const result = await ctx.run(resolved, args);
  if (result.exitCode !== 0) {
    throw new Error(firstLine(result.stderr) || `exit ${result.exitCode}`);
  }
}

export async function runAction(
  item: PlanItem,
  ctx: ActionContext,
  opts: { permanent?: boolean } = {},
): Promise<ActionResult> {
  switch (item.action) {
    case 'remove-path': {
      if (item.tier > 1) throw new Error('remove-path is only allowed for tier 0/1');
      await fs.rm(requirePath(item), { recursive: true, force: false });
      return { restorable: false };
    }

    case 'remove-dir-contents': {
      if (item.tier > 1) throw new Error('remove-dir-contents is only allowed for tier 0/1');
      const dir = requirePath(item);
      const names = await fs.readdir(dir);
      for (const name of names) {
        // rm on a symlink removes the link itself, never the target.
        await fs.rm(join(dir, name), { recursive: true, force: true });
      }
      return { restorable: false };
    }

    case 'trash-path': {
      if (opts.permanent === true) {
        if (item.tier !== 2) throw new Error('permanent delete only applies to tier 2 items');
        await fs.rm(requirePath(item), { recursive: true, force: false });
        return { restorable: false };
      }
      const result = await ctx.trash(requirePath(item));
      return { trashedPath: result.trashedPath, restorable: true };
    }

    case 'simctl-runtime-delete': {
      const uuid = item.match.actionArgs?.uuid;
      if (!uuid || !UUID_RE.test(uuid)) throw new Error('invalid runtime uuid');
      await ctx.run('xcrun', ['simctl', 'runtime', 'delete', uuid]);
      return { restorable: false };
    }

    case 'simctl-device-delete-unavailable': {
      await ctx.run('xcrun', ['simctl', 'delete', 'unavailable']);
      return { restorable: false };
    }

    case 'brew-cleanup': {
      await runCommand(ctx, 'brew', ['cleanup', '-s']);
      return { restorable: false };
    }

    case 'npm-cache-clean': {
      await runCommand(ctx, 'npm', ['cache', 'clean', '--force']);
      return { restorable: false };
    }

    case 'pnpm-store-prune': {
      await runCommand(ctx, 'pnpm', ['store', 'prune']);
      return { restorable: false };
    }

    case 'yarn-cache-clean': {
      await runCommand(ctx, 'yarn', ['cache', 'clean']);
      return { restorable: false };
    }

    case 'uv-cache-clean': {
      await runCommand(ctx, 'uv', ['cache', 'clean']);
      return { restorable: false };
    }

    case 'go-clean-build': {
      await runCommand(ctx, 'go', ['clean', '-cache']);
      return { restorable: false };
    }

    case 'go-clean-mod': {
      await runCommand(ctx, 'go', ['clean', '-modcache']);
      return { restorable: false };
    }

    case 'docker-builder-prune': {
      await runCommand(ctx, 'docker', ['builder', 'prune', '-f']);
      return { restorable: false };
    }

    case 'docker-image-prune': {
      const args = ['image', 'prune', '-f'];
      if (item.match.actionArgs?.all === 'true') args.push('-a');
      await runCommand(ctx, 'docker', args);
      return { restorable: false };
    }

    case 'docker-container-prune': {
      await runCommand(ctx, 'docker', ['container', 'prune', '-f']);
      return { restorable: false };
    }

    case 'empty-trash': {
      const trash = requirePath(item);
      if (item.permanentOnly !== true || trash !== join(ctx.home, '.Trash')) {
        throw new Error('empty-trash only applies to ~/.Trash');
      }
      const st = await fs.lstat(trash);
      if (st.isSymbolicLink()) throw new Error('refusing to empty a symlinked .Trash');
      if (!st.isDirectory()) throw new Error('empty-trash target is not a directory');
      const names = await fs.readdir(trash);
      for (const name of names) {
        // rm on a symlink removes the link itself, never the target.
        await fs.rm(join(trash, name), { recursive: true, force: true });
      }
      return { restorable: false };
    }

    case 'simctl-device-delete': {
      throw new Error('not supported yet');
    }
  }
}

import os from 'node:os';

import { measure } from '../fs/walker';
import { trashItem } from '../native/helper';
import { runProbe } from '../probes/run';
import { SafetyError } from '../safety/errors';
import { assertIdentity } from '../safety/identity';
import { assertSafeTarget } from '../safety/paths';
import type {
  ActionId,
  CleanupPlan,
  ExecuteOptions,
  ExecuteResult,
  ItemResult,
  JournalRecord,
  PlanItem,
} from '../types';
import { runAction, type ActionContext } from './actions';
import { checkPreflight } from './preflight';

const PATH_ACTIONS: ActionId[] = ['remove-path', 'remove-dir-contents', 'trash-path'];

function now(): string {
  return new Date().toISOString();
}

export async function executePlan(plan: CleanupPlan, opts: ExecuteOptions): Promise<ExecuteResult> {
  const home = opts.home ?? os.homedir();
  const run = opts.run ?? runProbe;
  const trash =
    opts.trash ??
    (async (p: string): Promise<{ trashedPath: string }> => {
      const result = await trashItem(p);
      return { trashedPath: result.trashedPath };
    });
  const ctx: ActionContext = { home, run, trash };
  const confirmed = new Set(opts.confirmedRuleIds ?? []);
  const permanentRules = new Set(opts.permanentRuleIds ?? []);
  // A dry run never touches the journal, even when a writer was supplied.
  const journal = opts.apply ? opts.journal : undefined;
  const results: ItemResult[] = [];

  if (journal) {
    await journal.append({
      type: 'run-start',
      runId: journal.runId,
      planId: plan.id,
      at: now(),
      apply: opts.apply,
      itemCount: plan.items.length,
    });
  }

  const processItem = async (item: PlanItem): Promise<ItemResult> => {
    const result: ItemResult = {
      itemId: item.id,
      ruleId: item.ruleId,
      action: item.action,
      status: 'dry-run',
      path: item.match.path,
      bytesBefore: item.match.bytesAllocated,
      bytesAfter: item.match.bytesAllocated,
      freed: 0,
      restorable: false,
    };

    if (opts.signal?.aborted) {
      result.status = 'skipped';
      result.reason = 'cancelled';
      return result;
    }

    const permanent = item.action === 'trash-path' && item.tier === 2 && permanentRules.has(item.ruleId);

    if (permanentRules.has(item.ruleId) && !confirmed.has(item.ruleId)) {
      result.status = 'skipped';
      result.reason = 'permanent delete needs typed confirmation';
      return result;
    }

    if (item.needsConfirmation && !confirmed.has(item.ruleId)) {
      result.status = 'skipped';
      result.reason = 'needs typed confirmation of the rule id';
      return result;
    }

    const blockers = await checkPreflight(item.preflight, run, {
      ...(opts.runningBundleIds ? { runningBundleIds: opts.runningBundleIds } : {}),
    });
    if (blockers.length > 0) {
      result.status = 'skipped';
      result.reason = `blocked: ${blockers.join('; ')}`;
      return result;
    }

    const isPath = PATH_ACTIONS.includes(item.action);
    if (isPath) {
      const target = item.match.path;
      if (!target) {
        result.status = 'failed';
        result.reason = 'match has no path';
        return result;
      }

      try {
        await assertSafeTarget(target, { id: item.ruleId, roots: item.roots }, { home });
        await assertIdentity(target, {
          dev: item.match.dev,
          ino: item.match.ino,
          kind: item.match.kind,
        });
      } catch (err) {
        if (err instanceof SafetyError) {
          result.status = 'skipped';
          result.reason = `refused: ${err.code}`;
          return result;
        }
        throw err;
      }

      const before = await measure(target);
      result.bytesBefore = before.allocated;
      result.bytesAfter = before.allocated;
    }

    if (!opts.apply) {
      result.status = 'dry-run';
      return result;
    }

    if (journal) {
      await journal.append({
        type: 'intent',
        runId: journal.runId,
        at: now(),
        itemId: item.id,
        ruleId: item.ruleId,
        action: item.action,
        path: item.match.path,
        ...(permanent ? { permanent: true } : {}),
      } as JournalRecord);
    }

    try {
      const actionResult = await runAction(item, ctx, { permanent });
      if (isPath && item.match.path) {
        result.bytesAfter = (await measure(item.match.path)).allocated;
      } else {
        result.bytesAfter = 0;
      }
      result.freed = Math.max(0, result.bytesBefore - result.bytesAfter);
      result.status = 'done';
      result.restorable = actionResult.restorable;
      if (actionResult.trashedPath !== undefined) result.trashedPath = actionResult.trashedPath;
    } catch (err) {
      result.status = 'failed';
      result.reason = err instanceof Error ? err.message : String(err);
      result.bytesAfter = result.bytesBefore;
      result.freed = 0;
    }

    return result;
  };

  for (const item of plan.items) {
    const result = await processItem(item);
    if (journal) {
      await journal.append({ type: 'result', runId: journal.runId, at: now(), result });
    }
    opts.onItem?.(result);
    results.push(result);
  }

  const freed = results.reduce((sum, r) => sum + r.freed, 0);

  if (journal) {
    await journal.append({ type: 'run-end', runId: journal.runId, at: now(), freed });
  }

  return { planId: plan.id, runId: journal?.runId, apply: opts.apply, results, freed };
}

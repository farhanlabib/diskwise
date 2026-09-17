import { ZodError } from 'zod';
import type { Rule } from '../types';
import { parseRule } from './schema';

// Roots a rule may never point at (or above). A rule root is rejected when,
// after trimming a trailing slash, it equals a denied root or is an ancestor of
// one (i.e. the denied root lives underneath it).
export const DENIED_ROOTS: readonly string[] = [
  '/',
  '~',
  '~/',
  '/System',
  '/Users',
  '/private/var/vm',
  '/private/var/db',
  '~/Library',
  '~/Library/Keychains',
  '~/Library/Messages',
  '~/Library/Mail',
  '~/Documents',
  '~/Desktop',
];

const TIER_2_ACTIONS = new Set(['trash-path', 'simctl-device-delete', 'empty-trash']);
const DESTRUCTIVE_ACTIONS = new Set(['remove-path', 'remove-dir-contents']);
const PERMANENT_ONLY_ACTIONS = new Set(['simctl-device-delete', 'empty-trash']);

function trimTrailingSlash(p: string): string {
  if (p.length > 1 && p.endsWith('/')) return p.replace(/\/+$/, '');
  return p;
}

function isAtOrInside(p: string, root: string): boolean {
  return p === root || p.startsWith(root + '/');
}

function lintRoots(rule: Rule): string[] {
  const messages: string[] = [];

  // (e) Denylisted roots. project-dirs legitimately searches broad roots ("~")
  // and confines itself in the matcher (skips hidden dirs and ~/Library, never
  // descends into the target name), so it is exempt from this one check.
  if (rule.matcher.kind !== 'project-dirs') {
    for (const rawRoot of rule.roots) {
      const root = trimTrailingSlash(rawRoot);
      for (const denied of DENIED_ROOTS) {
        const d = trimTrailingSlash(denied);
        if (root === d || d.startsWith(root + '/')) {
          messages.push(`root '${rawRoot}' is equal to or contains the denied root '${d}'`);
        }
      }
    }
  }

  // (g) path/glob-children/versioned-children targets must live inside a declared root.
  if (
    rule.matcher.kind === 'path' ||
    rule.matcher.kind === 'glob-children' ||
    rule.matcher.kind === 'versioned-children'
  ) {
    const target =
      rule.matcher.kind === 'path' ? rule.matcher.path : rule.matcher.root;
    const roots = rule.roots.map(trimTrailingSlash);
    const inside = roots.some((root) => isAtOrInside(trimTrailingSlash(target), root));
    if (!inside) {
      messages.push(`matcher path '${target}' is not inside any of the rule's roots`);
    }
  }

  return messages;
}

export function lintRule(rule: Rule): string[] {
  const { action, tier } = rule;
  // Roots are an execution allowlist. A tier 3 rule with no action can never touch disk,
  // so broad roots like '/' are acceptable there (e.g. listing '/Previous System*').
  const reportOnly = tier === 3 && action === null;
  const messages: string[] = reportOnly ? [] : [...lintRoots(rule)];

  // (a) destructive fs actions only at tier 0/1
  if (action !== null && DESTRUCTIVE_ACTIONS.has(action) && tier > 1) {
    messages.push(`action '${action}' is not allowed above tier 1 (rule is tier ${tier})`);
  }

  // (b) tier 3 is explanatory only
  if (tier === 3 && action !== null) {
    messages.push(`tier 3 rules must not have an action (found '${action}')`);
  }

  // (c) tier 2 may only move to Trash or use specific vendor deletes
  if (tier === 2 && action !== null && !TIER_2_ACTIONS.has(action)) {
    messages.push(
      `tier 2 rules may only use trash-path, simctl-device-delete or empty-trash (found '${action}')`,
    );
  }

  // (d) actions that cannot go to Trash must say so
  if (action !== null && PERMANENT_ONLY_ACTIONS.has(action) && rule.permanentOnly !== true) {
    messages.push(`action '${action}' requires permanentOnly: true`);
  }

  // (f) root-requiring rules are never automated: they need an exact command
  if (rule.needsRoot === true && !rule.manualCommand) {
    messages.push('needsRoot: true requires a manualCommand');
  }

  return messages;
}

export function validateRules(rules: unknown[]): {
  rules: Rule[];
  errors: { id: string; messages: string[] }[];
} {
  const parsed: Rule[] = [];
  const errors: { id: string; messages: string[] }[] = [];
  const seen = new Set<string>();

  for (const input of rules) {
    let rule: Rule;
    try {
      rule = parseRule(input);
    } catch (err) {
      const rawId = (input as { id?: unknown } | null)?.id;
      const id = typeof rawId === 'string' && rawId.length > 0 ? rawId : '<unknown>';
      const messages =
        err instanceof ZodError
          ? err.issues.map((issue) => {
              const where = issue.path.join('.') || '<root>';
              return `${where}: ${issue.message}`;
            })
          : [String(err)];
      errors.push({ id, messages });
      continue;
    }

    parsed.push(rule);

    if (seen.has(rule.id)) {
      errors.push({ id: rule.id, messages: ['duplicate rule id'] });
    } else {
      seen.add(rule.id);
    }

    const messages = lintRule(rule);
    if (messages.length > 0) {
      errors.push({ id: rule.id, messages });
    }
  }

  return { rules: parsed, errors };
}

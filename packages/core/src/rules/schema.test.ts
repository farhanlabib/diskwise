import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import type { Rule } from '../types';
import { parseRule } from './schema';

const base: Rule = {
  schemaVersion: 1,
  id: 'xcode.derived-data',
  title: 'Xcode DerivedData',
  category: 'dev',
  tier: 0,
  roots: ['~/Library/Developer/Xcode/DerivedData'],
  matcher: { kind: 'glob-children', root: '~/Library/Developer/Xcode/DerivedData' },
  action: 'remove-path',
  rationale: 'DerivedData is rebuilt locally by Xcode, so removing it costs only time.',
  regeneration: 'Xcode rebuilds it locally on the next build.',
};

describe('RuleSchema', () => {
  it('accepts a valid rule and returns it unchanged', () => {
    expect(parseRule(base)).toEqual(base);
  });

  it('accepts optional fields', () => {
    const rule: Rule = {
      ...base,
      macos: '>=14',
      requires: ['xcode'],
      preflight: { processes: ['Xcode'], bootedSimulators: true },
      minBytes: 50_000_000,
      needsRoot: true,
      manualCommand: 'sudo rm -rf /tmp/x',
      permanentOnly: true,
      docs: 'https://example.com',
      action: null,
    };
    expect(parseRule(rule)).toEqual(rule);
  });

  it('rejects an id without a dot-separated suffix', () => {
    expect(() => parseRule({ ...base, id: 'nodot' })).toThrow(ZodError);
    expect(() => parseRule({ ...base, id: 'Bad.Case' })).toThrow(ZodError);
    expect(() => parseRule({ ...base, id: '.leading' })).toThrow(ZodError);
  });

  it('rejects a tier outside 0..3', () => {
    expect(() => parseRule({ ...base, tier: 4 })).toThrow(ZodError);
    expect(() => parseRule({ ...base, tier: -1 })).toThrow(ZodError);
  });

  it('rejects unknown extra keys', () => {
    expect(() => parseRule({ ...base, sneaky: true })).toThrow(ZodError);
  });

  it('rejects a root that is not absolute or home-relative', () => {
    expect(() => parseRule({ ...base, roots: ['relative/path'] })).toThrow(ZodError);
    expect(() => parseRule({ ...base, roots: [] })).toThrow(ZodError);
  });

  it('rejects short rationale and regeneration text', () => {
    expect(() => parseRule({ ...base, rationale: 'too short' })).toThrow(ZodError);
    expect(() => parseRule({ ...base, regeneration: 'short' })).toThrow(ZodError);
  });

  it('rejects an unknown action and matcher kind', () => {
    expect(() => parseRule({ ...base, action: 'nuke-everything' })).toThrow(ZodError);
    expect(() => parseRule({ ...base, matcher: { kind: 'teleport' } })).toThrow(ZodError);
  });

  it('accepts a versioned-children matcher', () => {
    const matcher: Rule['matcher'] = {
      kind: 'versioned-children',
      root: '~/Library/Developer/Xcode/iOS DeviceSupport',
      keepNewest: 2,
    };
    expect(parseRule({ ...base, matcher }).matcher).toEqual(matcher);
  });

  it('rejects keepNewest 0 on a versioned-children matcher', () => {
    expect(() =>
      parseRule({
        ...base,
        matcher: { kind: 'versioned-children', root: '~/x', keepNewest: 0 },
      }),
    ).toThrow(ZodError);
  });
});

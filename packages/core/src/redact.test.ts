import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { redactAudit, redactText } from './redact';

const base = { home: '/Users/alice', username: 'alice' };

function sha(segment: string): string {
  return `h-${createHash('sha256').update(segment).digest('hex').slice(0, 8)}`;
}

describe('redactText', () => {
  it('replaces the home directory with ~', () => {
    expect(redactText('/Users/alice/Library/Caches', base)).toBe('~/Library/Caches');
    expect(redactText('ends at /Users/alice', base)).toBe('ends at ~');
  });

  it('replaces /Users/alice outside the home position with /Users/<user>', () => {
    expect(redactText('owner is /Users/alice!', base)).toBe('owner is /Users/<user>!');
  });

  it('replaces emails', () => {
    expect(redactText('mail alice@example.com now', base)).toBe('mail <email> now');
    expect(redactText('a.b+tag@sub.example.co.uk', base)).toBe('<email>');
  });

  it('replaces the hostname and its .local form case-insensitively', () => {
    const opts = { ...base, hostname: 'Alice-MBP' };
    expect(redactText('alice-mbp.local and Alice-MBP', opts)).toBe('<host> and <host>');
  });

  it('replaces external volume names', () => {
    expect(redactText('/Volumes/ExternalSSD/foo', base)).toBe('/Volumes/<volume>/foo');
    expect(redactText('/Volumes/Backup Drive/x', base)).toBe('/Volumes/<volume> Drive/x');
  });

  it('replaces the username as a whole word only', () => {
    expect(redactText('alice and malice', base)).toBe('<user> and malice');
    expect(redactText('bo', { home: '/Users/bo', username: 'bo' })).toBe('bo');
  });
});

describe('redactText with hashSegments', () => {
  const opts = { ...base, hashSegments: true };

  it('keeps known segments and hashes project names deterministically', () => {
    const expected = `~/Documents/${sha('acme-client')}/node_modules`;
    expect(redactText('~/Documents/acme-client/node_modules', opts)).toBe(expected);
    expect(redactText('~/Documents/acme-client/node_modules', opts)).toBe(
      redactText('~/Documents/acme-client/node_modules', opts),
    );
  });

  it('keeps "Application Support" and com.apple.* segments intact', () => {
    expect(redactText('~/Library/Application Support/MyApp', opts)).toBe(
      `~/Library/Application Support/${sha('MyApp')}`,
    );
    expect(redactText('~/Library/Containers/com.apple.mail/Data', opts)).toBe(
      `~/Library/Containers/com.apple.mail/${sha('Data')}`,
    );
  });
});

describe('redactAudit', () => {
  it('redacts nested strings without mutating the input', () => {
    const input = {
      a: '/Users/alice/x',
      b: ['/Users/alice/y'],
      c: { d: 'alice@example.com' },
      n: 5,
      empty: null,
    };
    const out = redactAudit(input, base);

    expect(input.a).toBe('/Users/alice/x');
    expect(input.b[0]).toBe('/Users/alice/y');
    expect(input.c.d).toBe('alice@example.com');

    expect(out.a).toBe('~/x');
    expect(out.b[0]).toBe('~/y');
    expect(out.c).toEqual({ d: '<email>' });
    expect(out.n).toBe(5);
    expect(out.empty).toBeNull();
  });
});

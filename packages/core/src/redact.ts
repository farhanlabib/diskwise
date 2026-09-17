import { createHash } from 'node:crypto';

export interface RedactOptions {
  home: string;
  username: string;
  hostname?: string;
  hashSegments?: boolean;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

const KEEP_SEGMENTS = new Set([
  'Library',
  'Application Support',
  'Caches',
  'Containers',
  'Group Containers',
  'Logs',
  'Developer',
  'Xcode',
  'DerivedData',
  'CoreSimulator',
  'Documents',
  'Desktop',
  'Downloads',
  'Pictures',
  'Movies',
  'Music',
  'node_modules',
  '.npm',
  '.cache',
  '.Trash',
  'Preferences',
  'HTTPStorages',
  'WebKit',
  'Saved Application State',
]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The path-token regex stops at whitespace, so multi-word keep-list segments
// would be torn apart. Their spaces become a sentinel while tokens are matched.
const SEGMENT_SPACE = '\u0001';
const MULTI_WORD_SEGMENTS = [...KEEP_SEGMENTS].filter((segment) => segment.includes(' '));

function protectMultiWordSegments(text: string): string {
  let out = text;
  for (const phrase of MULTI_WORD_SEGMENTS) {
    out = out.split(phrase).join(phrase.replace(/ /g, SEGMENT_SPACE));
  }
  return out;
}

function keepSegment(segment: string): boolean {
  const name = segment.split(SEGMENT_SPACE).join(' ');
  return KEEP_SEGMENTS.has(name) || name.startsWith('com.apple.');
}

function hashSegment(segment: string): string {
  return `h-${createHash('sha256').update(segment).digest('hex').slice(0, 8)}`;
}

function redactPathToken(token: string): string {
  const segments = token.split('/');
  return segments
    .map((segment, index) => {
      if (index === 0) return segment;
      if (keepSegment(segment)) return segment;
      return hashSegment(segment);
    })
    .join('/');
}

export function redactText(text: string, o: RedactOptions): string {
  let out = text;

  // 1. The home directory becomes "~".
  out = out.replace(new RegExp(`${escapeRegExp(o.home)}(?=/|$)`, 'g'), '~');

  // 2. Other users keep a placeholder name.
  out = out.split(`/Users/${o.username}`).join('/Users/<user>');

  // 3. Emails.
  out = out.replace(EMAIL_RE, '<email>');

  // 4. The machine name, with ".local" first so the suffix does not leak.
  if (o.hostname) {
    const host = escapeRegExp(o.hostname);
    out = out.replace(new RegExp(`${host}\\.local`, 'gi'), '<host>');
    out = out.replace(new RegExp(host, 'gi'), '<host>');
  }

  // 5. External volume names.
  out = out.replace(/\/Volumes\/[^/\s]+/g, '/Volumes/<volume>');

  // 6. The account name as a whole word, but never a substring like "malice".
  if (o.username.length >= 3) {
    out = out.replace(new RegExp(`\\b${escapeRegExp(o.username)}\\b`, 'g'), '<user>');
  }

  // 7. Project and app names inside the home directory.
  if (o.hashSegments) {
    out = protectMultiWordSegments(out);
    out = out.replace(/~\/[^\s'"`]+/g, redactPathToken);
    out = out.split(SEGMENT_SPACE).join(' ');
  }

  return out;
}

function redactValue(value: unknown, o: RedactOptions): unknown {
  if (typeof value === 'string') return redactText(value, o);
  if (Array.isArray(value)) return value.map((entry) => redactValue(entry, o));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = redactValue(entry, o);
    }
    return out;
  }
  return value;
}

export function redactAudit<T>(value: T, o: RedactOptions): T {
  return redactValue(value, o) as T;
}

import { randomBytes, timingSafeEqual } from 'node:crypto';

export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export function tokenMatches(header: string | undefined, token: string): boolean {
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const provided = Buffer.from(header.slice('Bearer '.length), 'utf8');
  const expected = Buffer.from(token, 'utf8');
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

export function hostAllowed(host: string | undefined, port: number): boolean {
  if (typeof host !== 'string') return false;
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

export function originAllowed(origin: string | undefined, port: number): boolean {
  if (origin === undefined) return true;
  return origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
}

export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy':
    "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

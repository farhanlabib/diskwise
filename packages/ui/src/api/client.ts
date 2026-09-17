const TOKEN_KEY = 'diskwise.token';

let token: string | null = null;
let initialized = false;

function readToken(): string | null {
  const hash = window.location.hash;
  const match = /(?:^#|&)t=([^&]+)/.exec(hash);
  if (!match) return null;
  const value = decodeURIComponent(match[1] ?? '');
  return value.length > 0 ? value : null;
}

function stripToken(): void {
  const url = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const cleaned = url.replace(/([#&])t=[^&]*/, '$1').replace(/[#&]$/, '');
  window.history.replaceState(null, '', cleaned.length > 0 ? cleaned : window.location.pathname);
}

export function getToken(): string | null {
  if (!initialized) {
    initialized = true;
    const fromHash = readToken();
    if (fromHash) {
      token = fromHash;
      window.sessionStorage.setItem(TOKEN_KEY, fromHash);
      stripToken();
    } else {
      token = window.sessionStorage.getItem(TOKEN_KEY);
    }
  }
  return token;
}

export const useMock: boolean =
  new URLSearchParams(window.location.search).has('mock') ||
  (import.meta.env.DEV && getToken() === null);

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message?: string) {
    super(message ?? `Request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
  }
}

function authHeaders(): Headers {
  const headers = new Headers();
  headers.set('Content-Type', 'application/json');
  const bearer = getToken();
  if (bearer) headers.set('Authorization', `Bearer ${bearer}`);
  return headers;
}

function notifyUnauthorized(): void {
  window.dispatchEvent(new CustomEvent('diskwise:unauthorized'));
}

function notifyDisconnected(): void {
  window.dispatchEvent(new CustomEvent('diskwise:disconnected'));
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === 'string') return body.error;
  } catch {
    /* body was not JSON */
  }
  return `Request failed with status ${response.status}`;
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: authHeaders(),
      cache: 'no-store',
      body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
    });
  } catch (error) {
    if (error instanceof TypeError) notifyDisconnected();
    throw error;
  }
  if (response.status === 401) {
    notifyUnauthorized();
    throw new ApiError(401, 'unauthorized');
  }
  if (!response.ok) throw new ApiError(response.status, await errorMessage(response));
  return (await response.json()) as T;
}

export const api = {
  get<T>(path: string): Promise<T> {
    return request<T>('GET', path);
  },
  post<T>(path: string, body: unknown = {}): Promise<T> {
    return request<T>('POST', path, body);
  },
};

// An <img src> cannot carry the Bearer header, so binary assets are fetched
// with fetch() and turned into an object URL by the caller.
export async function fetchBlob(path: string): Promise<Blob> {
  const headers = new Headers();
  const bearer = getToken();
  if (bearer) headers.set('Authorization', `Bearer ${bearer}`);
  let response: Response;
  try {
    response = await fetch(path, { headers, cache: 'no-store' });
  } catch (error) {
    if (error instanceof TypeError) notifyDisconnected();
    throw error;
  }
  if (response.status === 401) {
    notifyUnauthorized();
    throw new ApiError(401, 'unauthorized');
  }
  if (!response.ok) throw new ApiError(response.status, await errorMessage(response));
  return response.blob();
}

export async function streamJob(
  jobId: string,
  onEvent: (e: { event: string; data: unknown }) => void,
  signal?: AbortSignal,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/events`, {
      headers: authHeaders(),
      cache: 'no-store',
      signal,
    });
  } catch (error) {
    if (error instanceof TypeError) notifyDisconnected();
    throw error;
  }
  if (response.status === 401) {
    notifyUnauthorized();
    throw new ApiError(401, 'unauthorized');
  }
  if (!response.ok || !response.body) {
    throw new ApiError(response.status, await errorMessage(response));
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const emitLine = (line: string): void => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    try {
      onEvent(JSON.parse(trimmed) as { event: string; data: unknown });
    } catch {
      /* ignore a malformed line */
    }
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index = buffer.indexOf('\n');
    while (index >= 0) {
      emitLine(buffer.slice(0, index));
      buffer = buffer.slice(index + 1);
      index = buffer.indexOf('\n');
    }
  }
  emitLine(buffer);
}

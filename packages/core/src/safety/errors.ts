export type SafetyErrorCode =
  | 'NOT_ABSOLUTE'
  | 'OUTSIDE_ROOTS'
  | 'DENYLISTED'
  | 'SYMLINK_IN_PATH'
  | 'IDENTITY_MISMATCH'
  | 'MISSING'
  | 'TYPE_MISMATCH';

export class SafetyError extends Error {
  readonly code: SafetyErrorCode;
  readonly path: string;

  constructor(code: SafetyErrorCode, path: string, message?: string) {
    super(message ?? `${code}: ${path}`);
    this.name = 'SafetyError';
    this.code = code;
    this.path = path;
  }
}

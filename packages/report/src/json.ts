import type { AuditResult } from '@macsweep/core';

export function formatJson(result: AuditResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

import { describe, expect, it } from 'vitest';
import { HARDENED_ENV } from '@diskwise/core';
import './env';

describe('cli env setup', () => {
  it('stamps the updater and analytics suppression into the process env', () => {
    for (const [key, value] of Object.entries(HARDENED_ENV)) {
      expect(process.env[key]).toBe(value);
    }
  });
});

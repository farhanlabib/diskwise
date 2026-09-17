import type { Rule } from '../../types';
import { browserRules } from './browser';
import { cacheRules } from './caches';
import { devRules } from './dev';
import { dockerRules } from './docker';
import { osLeftoverRules } from './os-leftovers';
import { simulatorRules } from './simulator';
import { systemRules } from './system';
import { userDataRules } from './user-data';

export const allRules: Rule[] = [
  ...devRules,
  ...cacheRules,
  ...dockerRules,
  ...simulatorRules,
  ...osLeftoverRules,
  ...userDataRules,
  ...browserRules,
  ...systemRules,
];

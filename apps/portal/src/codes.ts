import type { CodeLoader } from '@revelation-srs/ui';

import { getFieldValueSet } from './api/me.js';

/** Every value of a field's value set (retired and hidden too), so any code a record holds has a label. */
export const loadCodes: CodeLoader = (entity, field) => getFieldValueSet(entity, field, 'all');

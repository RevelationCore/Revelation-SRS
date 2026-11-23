/** BP-06 pre-review G5 (BL-279): awards are conferred by an academic authority, never an IT role. */
import { PERMISSION_ROLES } from '@revelation-srs/domain';
import { describe, expect, it } from 'vitest';

describe('award conferment authority', () => {
  it('award:confer is held by registry and the conferment authority, not tenant or system administrators', () => {
    const holders = [...(PERMISSION_ROLES['award:confer'] as string[])].sort();
    expect(holders).toEqual(['conferment-authority', 'registry-administrator']);
    expect(holders).not.toContain('tenant-administrator');
    expect(holders).not.toContain('system-administrator');
  });
});

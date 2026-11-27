import { describe, expect, it } from 'vitest';
import {
  collectionCutoff,
  intelligenceListFilters,
  intelligenceOwnerInput,
} from './intelligence-list.js';

describe('intelligence list contracts', () => {
  it('uses rolling hours across daylight saving transitions and preserves the reference time', () => {
    const now = new Date('2026-11-02T06:30:00Z');
    expect(collectionCutoff('7d', now)?.toISOString()).toBe(
      '2026-10-26T06:30:00.000Z',
    );
    expect(collectionCutoff('30d', now)?.getTime()).toBe(
      now.getTime() - 30 * 86400000,
    );
    expect(collectionCutoff('90d', now)?.getTime()).toBe(
      now.getTime() - 90 * 86400000,
    );
    expect(collectionCutoff('all', now)).toBeNull();
    expect(now.toISOString()).toBe('2026-11-02T06:30:00.000Z');
  });
  it('validates supported dimensions and trims search', () => {
    expect(intelligenceListFilters.parse({ search: '  Alice  ' })).toEqual({
      search: 'Alice',
      range: 'all',
    });
    for (const value of [
      { market: 'CN' },
      { range: 'week' },
      { product: 'invalid product' },
      { range: ['7d', '30d'] },
    ])
      expect(intelligenceListFilters.safeParse(value).success).toBe(false);
  });
  it('requires explicit unassignment and a nonnegative integer revision', () => {
    expect(
      intelligenceOwnerInput.parse({ ownerId: null, revision: 0 }).ownerId,
    ).toBeNull();
    for (const value of [
      { revision: 0 },
      { ownerId: '', revision: 0 },
      { ownerId: null, revision: -1 },
      { ownerId: null, revision: 0.5 },
    ])
      expect(intelligenceOwnerInput.safeParse(value).success).toBe(false);
  });
});

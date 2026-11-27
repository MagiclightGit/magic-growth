import { describe, expect, it } from 'vitest';
import { informationDateLabel } from './information-times';

describe('information date precision', () => {
  it('shows a complete calendar date without manufacturing a time or timezone shift', () => {
    const label = informationDateLabel('2026-11-12');
    expect(label).toContain('2026');
    expect(label).toContain('11');
    expect(label).toContain('12');
    expect(label).not.toContain(':');
  });
  it('retains time and timezone for a precise timestamp', () => {
    expect(informationDateLabel('2026-11-16T21:40:22Z')).toContain(':');
  });
});

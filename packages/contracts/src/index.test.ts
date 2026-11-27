import { describe, expect, it } from 'vitest';
import {
  canonicalizeUrl,
  intelligenceInput,
  scheduleInput,
  canWrite,
} from './index.js';

describe('intelligence ingestion boundaries', () => {
  it('deduplicates tracking variants without discarding meaningful query parameters', () => {
    expect(
      canonicalizeUrl(
        'https://EXAMPLE.com/story?b=2&utm_source=mail&a=1&gclid=x#top',
      ),
    ).toBe('https://example.com/story?a=1&b=2');
    expect(canonicalizeUrl('https://example.com/?page=1')).not.toBe(
      canonicalizeUrl('https://example.com/?page=2'),
    );
  });
  it.each([
    'javascript:alert(1)',
    'file:///etc/passwd',
    'ftp://example.com/data',
  ])('rejects non-web evidence: %s', (sourceUrl) => {
    expect(
      intelligenceInput.safeParse({
        title: 'A title',
        summary: 'Some summary',
        sourceUrl,
        category: 'industry',
        product: 'MagicTattoo',
        market: 'US',
      }).success,
    ).toBe(false);
  });
  it('rejects unsupported roles for writes', () => {
    expect(canWrite('admin')).toBe(true);
    expect(canWrite('operator')).toBe(true);
    expect(canWrite('viewer')).toBe(false);
    expect(canWrite('owner')).toBe(false);
  });
  it('validates schedule time and IANA timezone before queuing', () => {
    const valid = {
      product: 'MagicTattoo',
      goal: 'Research tattoo industry trends',
      hour: 9,
      minute: 0,
      timezone: 'Asia/Shanghai',
    };
    expect(scheduleInput.safeParse(valid).success).toBe(true);
    expect(scheduleInput.safeParse({ ...valid, hour: 24 }).success).toBe(false);
    expect(
      scheduleInput.safeParse({ ...valid, timezone: 'invalid/timezone' })
        .success,
    ).toBe(false);
  });
});

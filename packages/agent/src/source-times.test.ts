import { describe, expect, it } from 'vitest';
import {
  collectSourceTime,
  isPublicAddress,
  normalizeSourceDate,
  parseSourceTimes,
} from './source-times.js';

describe('source time metadata', () => {
  it('separates article publication, modification and event calendar dates', () => {
    const result = parseSourceTimes(`<script type="application/ld+json">{
      "@graph":[{"@type":"WebPage","datePublished":"2025-09-07T23:35:04+00:00","dateModified":"2026-11-16T21:40:22+00:00"},
      {"@type":"Event","startDate":"2026-11-20","endDate":"2026-11-22"}]}</script>`);
    expect(result).toEqual({
      publishedAt: '2025-09-07T23:35:04+00:00',
      modifiedAt: '2026-11-16T21:40:22+00:00',
      eventStartsAt: '2026-11-20',
      eventEndsAt: '2026-11-22',
    });
  });
  it('uses explicit article metadata and ignores generic copyright years and HTTP dates', () => {
    expect(
      parseSourceTimes(
        '<meta property="article:published_time" content="2026-11-12"><meta property="article:modified_time" content="2026-11-13">',
      ).publishedAt,
    ).toBe('2026-11-12');
    expect(
      parseSourceTimes('<footer>©2026</footer><time>November 17</time>')
        .publishedAt,
    ).toBeNull();
    expect(
      parseSourceTimes('<script type="application/ld+json">invalid</script>')
        .modifiedAt,
    ).toBeNull();
  });
  it('does not choose an arbitrary event from a calendar with several events', () => {
    const result = parseSourceTimes(
      '<script type="application/ld+json">[{"@type":"Event","startDate":"2026-11-20"},{"@type":"Event","startDate":"2026-12-05"}]</script>',
    );
    expect(result.eventStartsAt).toBeNull();
  });
  it('preserves date precision and refuses invalid or inferred dates', () => {
    expect(normalizeSourceDate('2026-11-12')).toBe('2026-11-12');
    expect(normalizeSourceDate('2026-11-12T13:30:00')).toBe('2026-11-12');
    expect(normalizeSourceDate('yesterday')).toBeNull();
    expect(normalizeSourceDate('2026-02-30')).toBeNull();
  });
  it('blocks internal, mapped, reserved and non-public IP addresses', () => {
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '169.254.169.254',
      '192.168.1.2',
      '100.64.0.1',
      '::1',
      'fc00::1',
      'fe80::1',
      '::ffff:127.0.0.1',
      '2001:db8::1',
      '2002:7f00:1::',
    ])
      expect(isPublicAddress(address), address).toBe(false);
    expect(isPublicAddress('8.8.8.8')).toBe(true);
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
  });
  it('records an unavailable fetch without inventing timestamps or contacting internal services', async () => {
    const result = await collectSourceTime('http://127.0.0.1/');
    expect(result.status).toBe('unavailable');
    expect(result.publishedAt).toBeNull();
    expect(result.modifiedAt).toBeNull();
    expect(result.fetchedAt).toMatch(/^\d{4}-/);
  });
});

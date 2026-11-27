import { describe, expect, it } from 'vitest';
import { reportSources, validateCandidateSources } from './extract.js';
import type { CandidateInput } from '@guangmo/contracts';
import { extractionOutput } from '@guangmo/contracts';
import { z } from 'zod';
import {
  extractionModelOutput,
  timedExtractionModelOutput,
} from './extraction-schema.js';
describe('candidate evidence provenance', () => {
  it('uses relay-compatible string fields while rejecting invalid domain values locally', () => {
    const wireSchema = JSON.stringify(z.toJSONSchema(extractionModelOutput));
    expect(wireSchema).not.toContain('"format":"uri"');
    expect(wireSchema).not.toContain('"format":"date-time"');
    const timedWire = JSON.stringify(
      z.toJSONSchema(timedExtractionModelOutput),
    );
    expect(timedWire).not.toContain('"format"');
    expect(timedWire).toContain('eventStartsAt');
    expect(timedWire).not.toContain('sourceTimes');
    const value = {
      candidates: [
        {
          title: 'A finding',
          summary: 'A summary',
          product: 'MagicTattoo',
          market: 'US',
          category: 'industry',
          claimType: 'fact',
          publishedAt: null,
          language: null,
          tags: [],
          suggestedAction: '',
          sources: [
            { url: 'javascript:alert(1)', title: '', evidence: 'Claim' },
          ],
        },
      ],
    };
    expect(extractionModelOutput.safeParse(value).success).toBe(true);
    expect(extractionOutput.safeParse(value).success).toBe(false);
    value.candidates[0]!.sources[0]!.url = 'https://example.com';
    expect(extractionOutput.safeParse(value).success).toBe(true);
    expect(
      extractionOutput.safeParse({
        candidates: [{ ...value.candidates[0], publishedAt: 'yesterday' }],
      }).success,
    ).toBe(false);
  });
  it('recovers report URLs for historical runs and deduplicates tracking variants', () => {
    const result = reportSources(
      'See [official](https://example.com/docs). Also https://example.com/guide.',
      [
        { url: 'https://example.com/docs?utm_source=research' },
        { url: 'javascript:alert(1)' },
      ],
    );
    expect(result.map((v) => v.url)).toEqual([
      'https://example.com/docs',
      'https://example.com/guide',
    ]);
  });
  it('refuses invented sources even when the structured output otherwise parses', () => {
    const candidate: CandidateInput = {
      title: 'A finding',
      summary: 'A summary',
      product: 'MagicTattoo',
      market: 'US',
      category: 'industry',
      claimType: 'fact',
      publishedAt: null,
      language: null,
      tags: [],
      suggestedAction: '',
      sources: [
        { url: 'https://invented.example.com', title: '', evidence: 'Claim' },
      ],
    };
    expect(() =>
      validateCandidateSources([candidate], [{ url: 'https://example.com' }]),
    ).toThrow('报告之外');
    candidate.sources[0]!.url = 'https://example.com?utm_source=test';
    expect(
      validateCandidateSources([candidate], [{ url: 'https://example.com' }]),
    ).toHaveLength(1);
  });
});

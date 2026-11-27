import { describe, expect, it } from 'vitest';
import {
  calculateScore,
  scoreDimensions,
  scoreProposal,
  scoreWindowEnded,
  type ScoreSubject,
} from './scoring.js';
const dimensions = (values: (number | null)[]) =>
  scoreDimensions.parse(
    Object.fromEntries(
      ['relevance', 'actionability', 'timing', 'demand', 'novelty'].map(
        (key, i) => [
          key,
          { value: values[i], reason: '有依据的判定', sourceIndices: [] },
        ],
      ),
    ),
  );
describe('opportunity scoring rules', () => {
  it('weights dimensions, rounds once, and never renormalizes unknowns', () => {
    expect(calculateScore(dimensions([4, 3, 3, 3, 3])).total).toBe(81);
    expect(calculateScore(dimensions([4, 3, 3, 1, 2])).total).toBe(69);
    expect(calculateScore(dimensions([3, 3, 3, null, 2]))).toEqual({
      total: null,
      coverage: 80,
      lower: 57,
      upper: 78,
    });
    expect(calculateScore(dimensions([null, null, null, null, null]))).toEqual({
      total: null,
      coverage: 0,
      lower: 0,
      upper: 100,
    });
    expect(calculateScore(dimensions([0, 0, 0, 0, 0]))).toEqual({
      total: 0,
      coverage: 100,
      lower: 0,
      upper: 0,
    });
  });
  it('rejects invented fractional grades and model evidence verification', () => {
    expect(() => dimensions([3.7, 1, 1, 1, 1])).toThrow();
    expect(() =>
      scoreProposal.parse({
        dimensions: dimensions([1, 1, 1, 1, 1]),
        evidenceGrade: 'A',
        evidenceReason: 'official',
        gaps: [],
      }),
    ).toThrow();
  });
  it('expires date-only events in market timezone, preserving the event day', () => {
    const subject = { market: 'US', eventEndsAt: '2026-11-17' } as ScoreSubject;
    expect(scoreWindowEnded(subject, new Date('2026-11-18T02:00:00Z'))).toBe(
      false,
    );
    expect(scoreWindowEnded(subject, new Date('2026-11-18T05:00:01Z'))).toBe(
      true,
    );
    expect(
      scoreWindowEnded(
        { ...subject, eventEndsAt: '2026-11-17T12:00:00-05:00' },
        new Date('2026-11-17T17:00:01Z'),
      ),
    ).toBe(true);
  });
});

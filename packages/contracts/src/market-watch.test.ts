import { describe, it, expect } from 'vitest';
import {
  textDifference,
  dramaTrend,
  observationInput,
} from './market-watch.js';
const observation = {
  sourceUrl: 'https://example.com/chart',
  observedAt: '2026-11-15T00:00:00Z',
  metric: 'rank' as const,
  value: 20,
  unit: '名',
  scope: '美国日榜',
  claimType: 'fact' as const,
};
describe('competitor snapshot differences', () => {
  it('distinguishes first baseline, missing data and no change', () => {
    expect(textDifference(null, 'First').change).toBe('baseline');
    expect(textDifference('First', null).change).toBe('unknown');
    expect(textDifference('First', 'First').change).toBe('unchanged');
  });
  it('retains removed and added lines', () => {
    expect(
      textDifference('Starter $10\nPro $20', 'Starter $12\nPro $20'),
    ).toEqual({
      change: 'changed',
      removed: ['Starter $10'],
      added: ['Starter $12'],
    });
  });
});
describe('evidence-based drama trends', () => {
  it('treats decreasing ranks as rising', () => {
    const result = dramaTrend([
      observation,
      { ...observation, observedAt: '2026-11-16T00:00:00Z', value: 5 },
    ]);
    expect(result.state).toBe('rising');
    expect(result.delta).toBe(-15);
  });
  it('treats increasing counts as rising, zero as a valid baseline', () => {
    expect(
      dramaTrend([
        { ...observation, metric: 'views', value: 0 },
        {
          ...observation,
          metric: 'views',
          value: 50,
          observedAt: '2026-11-16T00:00:00Z',
        },
      ]).state,
    ).toBe('rising');
  });
  it('distinguishes stable and falling', () => {
    expect(
      dramaTrend([
        observation,
        { ...observation, observedAt: '2026-11-16T00:00:00Z' },
      ]).state,
    ).toBe('stable');
    expect(
      dramaTrend([
        observation,
        { ...observation, value: 30, observedAt: '2026-11-16T00:00:00Z' },
      ]).state,
    ).toBe('falling');
  });
  it('does not turn estimates, incomparable metrics or duplicate timestamps into growth', () => {
    for (const patch of [
      { claimType: 'estimate' as const },
      { sourceUrl: 'https://elsewhere.com/chart' },
      { scope: '英国日榜' },
      { unit: '分' },
      { metric: 'views' as const },
      { observedAt: observation.observedAt },
    ])
      expect(
        dramaTrend([
          observation,
          {
            ...observation,
            observedAt: '2026-11-16T00:00:00Z',
            value: 1,
            ...patch,
          },
        ]).state,
      ).toBe('unknown');
  });
  it('rejects fractional and zero ranks', () => {
    for (const value of [0, 1.5])
      expect(
        observationInput.safeParse({ ...observation, value }).success,
      ).toBe(false);
  });
});

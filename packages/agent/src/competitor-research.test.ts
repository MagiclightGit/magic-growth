import { describe, it, expect } from 'vitest';
import {
  competitorDimensions,
  type CompetitorFinding,
} from '@guangmo/contracts';
import {
  validateCompetitorFindings,
  competitorResearchGoal,
} from './competitor-research.js';
const sources = [{ url: 'https://example.com/pricing' }];
function entries(): CompetitorFinding[] {
  return competitorDimensions.map((dimension) => ({
    dimension,
    availability: 'found',
    claimType: 'fact',
    summary: 'Public offering observed in the current research.',
    evidence: [
      {
        url: sources[0]!.url,
        title: 'Public source',
        basis: 'A report evidence summary, not a direct quotation.',
      },
    ],
    change: 'changed',
    comparison: 'Comparable evidence describes a change.',
  }));
}
describe('competitor monitoring evidence policy', () => {
  it('requires all six unique dimensions', () => {
    const findings = entries();
    findings[5] = findings[0]!;
    expect(() =>
      validateCompetitorFindings({ findings }, sources, null),
    ).toThrow('维度');
  });
  it('rejects a URL never discovered in this research', () => {
    const findings = entries();
    findings[0]!.evidence[0]!.url = 'https://fabricated.example/a';
    expect(() =>
      validateCompetitorFindings({ findings }, sources, null),
    ).toThrow('来源');
  });
  it('establishes a baseline only for evidence-backed first observations', () => {
    const findings = entries();
    findings[4]!.evidence = [];
    const checked = validateCompetitorFindings({ findings }, sources, null);
    expect(checked[0]!.change).toBe('baseline');
    expect(checked[4]!.availability).toBe('unknown');
    expect(checked[4]!.change).toBe('unknown');
  });
  it('does not interpret previously unknown information as a new change', () => {
    const before = entries();
    before[0]!.availability = 'unknown';
    expect(
      validateCompetitorFindings({ findings: entries() }, sources, before)[0]!
        .change,
    ).toBe('unknown');
  });
  it('keeps estimated and analytical content separate from comparable factual changes', () => {
    for (const claimType of ['estimate', 'analysis'] as const) {
      const findings = entries();
      findings[1]!.claimType = claimType;
      const checked = validateCompetitorFindings(
        { findings },
        sources,
        entries(),
      );
      expect(checked[1]!.claimType).toBe(claimType);
      expect(checked[1]!.change).toBe('unknown');
    }
    expect(
      validateCompetitorFindings(
        { findings: entries() },
        sources,
        entries(),
      )[0]!.change,
    ).toBe('changed');
  });
  it('investigates actual ads and independent reviews without invented metrics', () => {
    const goal = competitorResearchGoal(
      {
        product: 'test',
        name: 'Example',
        website: 'https://example.com',
        market: 'US',
        focus: 'Updates',
        sources: [],
        enabled: false,
        intervalHours: 24,
      },
      null,
    );
    for (const term of [
      '广告',
      '用户评价',
      '未知',
      '币种',
      '计费周期',
      '不登录',
    ])
      expect(goal).toContain(term);
  });
});

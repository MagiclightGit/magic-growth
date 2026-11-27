import { expect, it } from 'vitest';
import {
  scoreContext,
  scoreProposal,
  type ScoreInput,
} from '@guangmo/contracts';
import { validateScoreProposal } from './score.js';
const input: ScoreInput = {
  subject: {
    title: '活动',
    summary: '一个真实活动',
    market: 'US',
    product: 'MagicTattoo',
    category: 'industry',
    suggestedAction: '',
    publishedAt: null,
    eventStartsAt: null,
    eventEndsAt: null,
    status: 'pending',
    sources: [
      { url: 'https://example.com', title: 'source', evidence: 'date' },
    ],
  },
  context: scoreContext.parse({}),
  history: [],
  assessedAt: '2026-11-17T00:00:00Z',
};
const proposal = () =>
  scoreProposal.parse({
    dimensions: Object.fromEntries(
      ['relevance', 'actionability', 'timing', 'demand', 'novelty'].map(
        (key) => [key, { value: 4, reason: '模型建议', sourceIndices: [0] }],
      ),
    ),
    evidenceGrade: 'B',
    evidenceReason: '待核实',
    gaps: [],
  });
it('enforces missing context and internal-data ceilings outside the model', () => {
  const result = validateScoreProposal(proposal(), input);
  expect(Object.values(result.dimensions).map((d) => d.value)).toEqual([
    3,
    2,
    null,
    3,
    null,
  ]);
  expect(proposal().dimensions.timing.value).toBe(4);
});
it('rejects source indices outside supplied evidence', () => {
  const result = proposal();
  result.dimensions.demand.sourceIndices = [1];
  expect(() => validateScoreProposal(result, input)).toThrow('输入之外');
});

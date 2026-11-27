import { z } from 'zod';

export const SCORING_VERSION = 'opportunity/v1-draft';
export const scoreKeys = [
  'relevance',
  'actionability',
  'timing',
  'demand',
  'novelty',
] as const;
export const scoreLabels = {
  relevance: '业务匹配',
  actionability: '行动可行',
  timing: '时间窗口',
  demand: '需求信号',
  novelty: '增量价值',
} as const;
export const scoreWeights = {
  relevance: 25,
  actionability: 25,
  timing: 20,
  demand: 20,
  novelty: 10,
} as const;
const dimension = z.object({
  value: z.number().int().min(0).max(4).nullable(),
  reason: z.string().trim().min(1).max(1200),
  sourceIndices: z.array(z.number().int().min(0)).max(10),
});
export const scoreDimensions = z.object({
  relevance: dimension,
  actionability: dimension,
  timing: dimension,
  demand: dimension,
  novelty: dimension,
});
export type ScoreDimensions = z.infer<typeof scoreDimensions>;
export const scoreContext = z.object({
  growthGoal: z.string().trim().max(1000).default(''),
  audience: z.string().trim().max(500).default(''),
  action: z.string().trim().max(1000).default(''),
  preparationDays: z.number().int().min(0).max(365).nullable().default(null),
  resourcesConfirmed: z.boolean().default(false),
});
export type ScoreContext = z.infer<typeof scoreContext>;
export const scoringRequest = z.object({
  context: scoreContext.default(() => scoreContext.parse({})),
});
export const scoreProposal = z.object({
  dimensions: scoreDimensions,
  evidenceGrade: z.enum(['B', 'C', 'U']),
  evidenceReason: z.string().trim().min(1).max(2000),
  gaps: z.array(z.string().trim().min(1).max(400)).max(10),
});
export type ScoreProposal = z.infer<typeof scoreProposal>;
export type ScoreTarget = 'candidate' | 'intelligence';
export interface ScoreSource {
  url: string;
  title: string;
  evidence: string;
}
export interface ScoreSubject {
  title: string;
  summary: string;
  product: string;
  market: string;
  category: string;
  suggestedAction: string;
  claimType?: string | null;
  sourceTimes?: import('./workflow.js').SourceTime[];
  publishedAt: string | null;
  eventStartsAt: string | null;
  eventEndsAt: string | null;
  sources: ScoreSource[];
  status: string;
}
export interface ScoreInput {
  subject: ScoreSubject;
  context: ScoreContext;
  history: { title: string; summary: string }[];
  assessedAt: string;
}
export function calculateScore(dimensions: ScoreDimensions) {
  let contribution = 0;
  let coverage = 0;
  for (const key of scoreKeys) {
    const value = dimensions[key].value;
    if (value !== null) {
      coverage += scoreWeights[key];
      contribution += (value * scoreWeights[key]) / 4;
    }
  }
  return {
    total: coverage === 100 ? Math.round(contribution) : null,
    coverage,
    lower: Math.floor(contribution),
    upper: Math.ceil(contribution + 100 - coverage),
  };
}
export function scoreBand(total: number) {
  return total >= 80
    ? '优先评审'
    : total >= 60
      ? '建议验证'
      : total >= 40
        ? '持续观察'
        : '暂缓跟进';
}
export interface OpportunityScore {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  version: string;
  context: ScoreContext;
  proposal: ScoreProposal | null;
  calculation: ReturnType<typeof calculateScore> | null;
  evaluatedAt: string | null;
  reviewDueAt: string | null;
  stale: boolean;
  windowEnded: boolean;
  excluded: boolean;
  error: string | null;
}
// A date-only event expires at the end of that date in its target market.
export function scoreWindowEnded(subject: ScoreSubject, now = new Date()) {
  const end = subject.eventEndsAt;
  if (!end) return false;
  if (end.length > 10) return new Date(end).getTime() < now.getTime();
  const timezone = (
    {
      US: 'America/New_York',
      UK: 'Europe/London',
      EU: 'Europe/Paris',
    } as Record<string, string>
  )[subject.market];
  // A global date has no known local timezone: wait until the date is over everywhere.
  if (!timezone)
    return (
      end < new Date(now.getTime() - 14 * 3600000).toISOString().slice(0, 10)
    );
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = (type: string) => parts.find((p) => p.type === type)!.value;
  return end < `${value('year')}-${value('month')}-${value('day')}`;
}

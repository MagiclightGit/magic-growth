import { z } from 'zod';
import { productId } from './products.js';
import { webUrl, marketSchema } from './workflow.js';
import { watchKinds } from './market-watch.js';
export const competitorDimensions = Object.keys(
  watchKinds,
) as (keyof typeof watchKinds)[];
export const competitorRelationshipLabels = {
  direct: '直接竞品',
  substitute: '视频与创意替代品',
  adjacent: '本地服务邻接产品',
  unclassified: '未分类',
} as const;
export const competitorRelationship = z.enum(
  Object.keys(
    competitorRelationshipLabels,
  ) as (keyof typeof competitorRelationshipLabels)[],
);
export const competitorProfileInput = z.object({
  product: productId,
  name: z.string().trim().min(2).max(120),
  website: webUrl,
  market: marketSchema,
  relationship: competitorRelationship.optional(),
  focus: z.string().trim().max(3000).default(''),
  sources: z.array(webUrl).max(10).default([]),
  intervalHours: z.number().int().min(6).max(168).default(24),
  enabled: z.boolean().default(true),
});
export type CompetitorProfileInput = z.infer<typeof competitorProfileInput>;
export const competitorProfileEdit = z.object({
  revision: z.number().int().min(0),
  data: competitorProfileInput.omit({ product: true }),
});
export const competitorEvidence = z.object({
  url: webUrl,
  title: z.string().max(300),
  basis: z.string().max(2000),
});
export const competitorFinding = z.object({
  dimension: z.enum([
    'product',
    'pricing',
    'landing',
    'content',
    'ads',
    'reviews',
  ]),
  availability: z.enum(['found', 'unknown']),
  summary: z.string().min(1).max(5000),
  claimType: z.enum(['fact', 'estimate', 'analysis']),
  evidence: z.array(competitorEvidence).max(8),
  change: z.enum(['baseline', 'changed', 'unchanged', 'unknown']),
  comparison: z.string().max(3000),
});
export const competitorFindingsOutput = z.object({
  findings: z.array(competitorFinding).length(6),
});
export type CompetitorFinding = z.infer<typeof competitorFinding>;
export interface CompetitorProfile extends z.infer<
  typeof competitorProfileInput
> {
  id: string;
  revision: number;
  createdAt: string;
  nextRunAt: string;
  latest: CompetitorResearchRun | null;
}
export interface CompetitorResearchRun {
  id: string;
  competitorId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  stage: 'research' | 'analysis';
  attempts: number;
  generation: number;
  report: string | null;
  findings: CompetitorFinding[] | null;
  previousRunId: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
  model: string | null;
  workflowVersion: string;
  config: CompetitorProfileInput;
}
export interface CompetitorResearchEvent {
  id: string;
  runId: string;
  message: string;
  data: {
    kind: 'search' | 'source' | 'status';
    url?: string;
    title?: string;
  } | null;
  createdAt: string;
}
export interface CompetitorProfileDetail extends CompetitorProfile {
  runs: CompetitorResearchRun[];
}
export interface CompetitorRunDetail extends CompetitorResearchRun {
  events: CompetitorResearchEvent[];
  previous: CompetitorResearchRun | null;
  published: Record<string, string>;
}

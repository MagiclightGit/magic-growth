import { productId as productSchema } from './products.js';
import { z } from 'zod';

export const COLLECTION_WORKFLOW_VERSION = 'research-to-intelligence/v2';
// Preserve date-only precision; never manufacture midnight for a calendar date.
export const informationDate = z.union([
  z.iso.date(),
  z.iso.datetime({ offset: true }),
]);
export const sourceTimeInput = z.object({
  url: z.url(),
  fetchedAt: z.iso.datetime(),
  status: z.enum(['ok', 'unavailable']),
  publishedAt: informationDate.nullable(),
  modifiedAt: informationDate.nullable(),
  eventStartsAt: informationDate.nullable(),
  eventEndsAt: informationDate.nullable(),
});
export type SourceTime = z.infer<typeof sourceTimeInput>;
export { productId as productSchema } from './products.js';
export const marketSchema = z.enum(['US', 'UK', 'EU', 'Global']);
export const categorySchema = z.enum([
  'industry',
  'competitor',
  'merchant',
  'content',
]);
export const webUrl = z
  .url()
  .refine(
    (value) => ['https:', 'http:'].includes(new URL(value).protocol),
    '仅支持 HTTP(S) 来源',
  );
export const evidenceInput = z.object({
  url: webUrl,
  title: z.string().trim().max(300),
  evidence: z.string().trim().min(1).max(2000),
});
export const verticalLabels = {
  tattoo: '纹身',
  nails: '美甲',
  hair_barber: '美发 / 理发',
  beauty_lash_brow: '美容 / 美睫 / 美眉',
  other_local_service: '其他本地服务',
  cross_industry: '跨行业',
} as const;
export const verticalSchema = z.enum(
  Object.keys(verticalLabels) as (keyof typeof verticalLabels)[],
);

export const candidateInput = z.object({
  title: z.string().trim().min(2).max(200),
  summary: z.string().trim().min(5).max(12000),
  product: productSchema,
  market: marketSchema,
  category: categorySchema,
  vertical: verticalSchema.optional(),
  claimType: z.enum(['fact', 'estimate', 'analysis', 'source_claim']),
  publishedAt: informationDate.nullable(),
  eventStartsAt: informationDate.nullable().optional(),
  eventEndsAt: informationDate.nullable().optional(),
  sourceTimes: z.array(sourceTimeInput).max(10).optional(),
  language: z.string().trim().min(2).max(20).nullable(),
  tags: z.array(z.string().trim().min(1).max(40)).max(10),
  suggestedAction: z.string().trim().max(2000),
  sources: z.array(evidenceInput).min(1).max(10),
});
export const extractionOutput = z.object({
  candidates: z.array(candidateInput).max(10),
});
export type CandidateInput = z.infer<typeof candidateInput>;
export type EvidenceInput = z.infer<typeof evidenceInput>;
export const candidateStatusLabels = {
  pending: '待审核',
  needs_evidence: '待补证',
  approved: '已通过',
  rejected: '已拒绝',
} as const;
export const candidateStatus = z.enum(
  Object.keys(candidateStatusLabels) as (keyof typeof candidateStatusLabels)[],
);
export type CandidateStatus = z.infer<typeof candidateStatus>;
export interface Candidate extends CandidateInput {
  scoring?: import('./scoring.js').OpportunityScore | null;
  id: string;
  runId: string | null;
  extractionId: string | null;
  collectionRunId?: string | null;
  origin?: 'competitor' | 'social';
  reviewReason: string | null;
  reviewedAt: string | null;
  status: CandidateStatus;
  intelligenceId: string | null;
  revision: number;
  createdAt: string;
}
export interface Extraction {
  id: string;
  runId: string;
  workflowVersion: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  generation: number;
  attempts: number;
  error: string | null;
  completedAt: string | null;
}
export interface CandidateBatch {
  extraction: Extraction | null;
  candidates: Candidate[];
}
export const reviewInput = z
  .object({
    revision: z.number().int().min(0),
    action: z.enum(['approve', 'reject', 'request_evidence', 'merge']),
    reason: z.string().trim().max(500).optional(),
    targetId: z.uuid().optional(),
  })
  .refine((input) => input.action === 'approve' || Boolean(input.reason), {
    path: ['reason'],
    message: '请填写审核原因',
  })
  .refine((input) => (input.action === 'merge') === Boolean(input.targetId), {
    path: ['targetId'],
    message: '请选择要合并的情报',
  });
export type CandidateReviewInput = z.infer<typeof reviewInput>;

export const manualCandidateInput = candidateInput
  .pick({
    title: true,
    summary: true,
    product: true,
    market: true,
    category: true,
    vertical: true,
    claimType: true,
    publishedAt: true,
    suggestedAction: true,
  })
  .extend({
    sourceUrl: webUrl,
    evidence: z.string().trim().max(2000).default(''),
  });
export type ManualCandidateInput = z.infer<typeof manualCandidateInput>;
export const candidateEditInput = z.object({
  revision: z.number().int().min(0),
  candidate: candidateInput,
});

export const taskKind = z.enum(['content', 'outreach']);
export const taskStatus = z.enum([
  'pending',
  'in_progress',
  'in_review',
  'completed',
  'failed',
  'cancelled',
]);
export type TaskStatus = z.infer<typeof taskStatus>;
export const taskTransitions: Record<TaskStatus, readonly TaskStatus[]> = {
  pending: ['in_progress', 'cancelled'],
  in_progress: ['in_review', 'failed', 'cancelled'],
  in_review: ['in_progress', 'completed', 'cancelled'],
  completed: [],
  failed: ['pending', 'cancelled'],
  cancelled: ['pending'],
};
export function canTransitionTask(from: TaskStatus, to: TaskStatus) {
  return from === to || taskTransitions[from].includes(to);
}
export const taskInput = z.object({
  title: z.string().trim().min(2).max(200),
  kind: taskKind,
  channel: z.string().trim().min(1).max(80),
  assigneeId: z.string().min(1).max(100),
  dueAt: z.iso.datetime().nullable(),
  priority: z.enum(['low', 'normal', 'high']),
});
export const taskUpdateInput = taskInput
  .omit({ kind: true })
  .partial()
  .extend({
    revision: z.number().int().min(0),
    status: taskStatus.optional(),
    result: z.string().trim().max(12000).optional(),
  });
export type TaskInput = z.infer<typeof taskInput>;
export interface WorkflowTask extends TaskInput {
  brief?: string | null;
  id: string;
  intelligenceId: string;
  product: string;
  market: string;
  status: TaskStatus;
  result: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
export interface Assignee {
  id: string;
  name: string;
}
export interface IntelligenceEvidence extends EvidenceInput {
  id: string;
  runId: string | null;
}
export const claimTypeLabels = {
  fact: '事实',
  source_claim: '来源自述',
  estimate: '估算',
  analysis: '分析判断',
} as const;
export const taskStatusLabels: Record<TaskStatus, string> = {
  pending: '待处理',
  in_progress: '进行中',
  in_review: '待审核',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

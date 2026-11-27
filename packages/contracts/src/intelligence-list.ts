import { productId } from './products.js';
import { z } from 'zod';
import { verticalSchema } from './workflow.js';
import type { CandidateInput } from './workflow.js';
import type { IntelligenceItem } from './index.js';

export const marketLabels = {
  US: '美国',
  UK: '英国',
  EU: '欧洲',
  Global: '全球',
} as const;
export const intelligenceListFilters = z.object({
  search: z.string().trim().max(200).optional(),
  status: z.enum(['pending', 'verified', 'irrelevant']).optional(),
  category: z
    .enum(['industry', 'competitor', 'merchant', 'content'])
    .optional(),
  product: productId.optional(),
  market: z.enum(['US', 'UK', 'EU', 'Global']).optional(),
  range: z.enum(['all', '24h', '7d', '30d', '90d']).default('all'),
  dateField: z.enum(['published', 'collected']).optional(),
  vertical: verticalSchema.optional(),
  view: z
    .enum(['today', 'industry', 'competitor', 'social', 'history'])
    .optional(),
  owner: z.string().trim().min(1).max(100).optional(),
});
export type IntelligenceListFilters = z.infer<typeof intelligenceListFilters>;
export function collectionCutoff(
  range: IntelligenceListFilters['range'],
  now = new Date(),
) {
  const days = { all: 0, '24h': 1, '7d': 7, '30d': 30, '90d': 90 }[range];
  return days ? new Date(now.getTime() - days * 86400000) : null;
}
export const intelligenceOwnerInput = z.object({
  ownerId: z.string().trim().min(1).max(100).nullable(),
  revision: z.number().int().min(0),
});
export interface IntelligenceOwner {
  id: string;
  name: string;
  disabled: boolean;
  role: string;
}
export interface IntelligenceTaskSummary {
  id: string;
  title: string;
  kind: 'content' | 'outreach';
  channel: string;
  status: import('./workflow.js').TaskStatus;
  result: string | null;
  assigneeName: string | null;
}
export interface IntelligenceListItem extends IntelligenceItem {
  metadata?: Pick<
    CandidateInput,
    'vertical' | 'publishedAt' | 'suggestedAction' | 'claimType'
  > | null;
  ownerId: string | null;
  ownerRevision: number;
  owner: IntelligenceOwner | null;
  taskSummary: IntelligenceTaskSummary[];
}

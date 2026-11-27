import { z } from 'zod';
import { productId } from './products.js';
import {
  categorySchema,
  marketSchema,
  verticalSchema,
  webUrl,
} from './workflow.js';

export const feedSourceInput = z.object({
  name: z.string().trim().min(2).max(120),
  url: webUrl.max(2048).refine((value) => {
    const url = new URL(value);
    return !url.username && !url.password && !url.port;
  }, '请输入不含凭据的公开订阅地址'),
  product: productId,
  market: marketSchema,
  vertical: verticalSchema,
  category: categorySchema,
  intervalHours: z.coerce.number().int().min(6).max(168),
  permissionNote: z.string().trim().min(5).max(500),
});
export type FeedSourceInput = z.infer<typeof feedSourceInput>;
export type CollectionRunStatus = 'queued' | 'running' | 'succeeded' | 'failed';
export interface CollectionRun {
  id: string;
  sourceId: string;
  status: CollectionRunStatus;
  attempts: number;
  discovered: number | null;
  added: number | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}
export interface FeedSource extends FeedSourceInput {
  id: string;
  enabled: boolean;
  revision: number;
  lastSuccessAt: string | null;
  latest: CollectionRun | null;
}

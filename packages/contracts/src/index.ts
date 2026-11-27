import { productId } from './products.js';
import { z } from 'zod';
export const roleSchema = z.enum(['admin', 'operator', 'viewer']);
export type Role = z.infer<typeof roleSchema>;
export const intelligenceInput = z.object({
  title: z.string().trim().min(2).max(200),
  summary: z.string().trim().min(5).max(12000),
  sourceUrl: z
    .url()
    .refine(
      (url) => ['https:', 'http:'].includes(new URL(url).protocol),
      '仅支持 HTTP(S) 来源',
    ),
  category: z.enum(['industry', 'competitor', 'merchant', 'content']),
  product: productId,
  market: z.enum(['US', 'UK', 'EU', 'Global']),
});
export const intelligenceStatus = z.enum(['pending', 'verified', 'irrelevant']);
export type IntelligenceInput = z.infer<typeof intelligenceInput>;
export const researchInput = z.object({
  product: productId,
  goal: z.string().trim().min(10).max(2000),
});
export const memberInput = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.email(),
  password: z.string().min(12).max(128),
  role: roleSchema,
  productIds: z.array(productId).max(100).default([]),
});
export const RESEARCH_QUEUE = 'guangmo-research';
export const runStatus = z.enum(['queued', 'running', 'succeeded', 'failed']);
export type RunStatus = z.infer<typeof runStatus>;
export const categoryLabels = {
  industry: '行业动态',
  competitor: '竞品变化',
  merchant: '商户信号',
  content: '内容机会',
} as const;
export interface IntelligenceItem extends IntelligenceInput {
  scoring?: import('./scoring.js').OpportunityScore | null;
  id: string;
  status: z.infer<typeof intelligenceStatus>;
  createdAt: string;
}
export interface ResearchRun {
  product: string | null;
  id: string;
  goal: string;
  status: RunStatus;
  result: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}
export interface Overview {
  total: number;
  pending: number;
  verified: number;
  runs: number;
  recentItems: IntelligenceItem[];
  recentRuns: ResearchRun[];
}
export interface IntegrationStatus {
  agentConfigured: boolean;
  queueAvailable: boolean;
}
export function redisConnection(url: string) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    username: parsed.username || undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db: Number(parsed.pathname.slice(1) || 0),
    ...(parsed.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}
export function canWrite(role: string) {
  return role === 'admin' || role === 'operator';
}
export function canonicalizeUrl(raw: string) {
  const url = new URL(raw);
  url.hash = '';
  for (const key of [...url.searchParams.keys()])
    if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  return url.toString();
}

export const scheduleInput = researchInput.extend({
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
  timezone: z.string().refine((tz) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, '无效时区'),
});
export interface ResearchSchedule {
  product: string | null;
  id: string;
  createdBy: string;
  goal: string;
  hour: number;
  minute: number;
  timezone: string;
  enabled: boolean;
}

export interface ResearchEventData {
  kind: 'search' | 'source' | 'status';
  url?: string;
  title?: string;
}
export interface ResearchEvent {
  id: string;
  message: string;
  data: ResearchEventData | null;
  createdAt: string;
}
export interface ResearchDetail extends ResearchRun {
  events: ResearchEvent[];
}

export * from './workflow.js';
export * from './scoring.js';
export * from './intelligence-list.js';

export * from './products.js';
export * from './market-watch.js';
export * from './competitor-research.js';

export * from './research-conversations.js';
export * from './collection.js';
export * from './briefs.js';

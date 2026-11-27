import { z } from 'zod';
import { productId } from './products.js';
import {
  webUrl,
  marketSchema,
  taskInput,
  verticalSchema,
  informationDate,
} from './workflow.js';
export const watchKinds = {
  product: '产品变化',
  pricing: '定价',
  landing: '落地页',
  content: '内容',
  ads: '广告创意',
  reviews: '用户评价',
} as const;
export const watchInput = z.object({
  product: productId,
  name: z.string().trim().min(2).max(120),
  market: marketSchema,
  kind: z.enum(['product', 'pricing', 'landing', 'content', 'ads', 'reviews']),
  url: webUrl,
  intervalHours: z.number().int().min(1).max(168).default(24),
});
export const watchConfigInput = watchInput
  .omit({ product: true })
  .extend({ revision: z.number().int().min(0) });
export const watchUpdate = z.object({
  enabled: z.boolean(),
  revision: z.number().int().min(0),
});
export const priceObservation = z.object({
  plan: z.string().trim().min(1).max(120),
  locale: z
    .string()
    .trim()
    .regex(/^[a-z]{2,3}-[A-Z]{2}$/),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/),
  interval: z.enum(['monthly', 'annual', 'one_time']),
  amount: z.coerce.number().finite().nonnegative().max(1e8),
});
export type PriceObservation = z.infer<typeof priceObservation>;
export function priceComparison(
  before: PriceObservation | null,
  after: PriceObservation,
) {
  if (!before) return 'baseline';
  if (
    before.plan !== after.plan ||
    before.locale !== after.locale ||
    before.currency !== after.currency ||
    before.interval !== after.interval
  )
    return 'unknown';
  return before.amount === after.amount ? 'unchanged' : 'changed';
}
export const manualSnapshot = z.object({
  content: z.string().trim().min(10).max(30000),
  claimType: z.enum(['fact', 'estimate', 'analysis']),
  note: z.string().trim().max(2000).default(''),
  price: priceObservation.optional(),
});
export interface Watch {
  id: string;
  product: string;
  name: string;
  market: z.infer<typeof marketSchema>;
  kind: keyof typeof watchKinds;
  url: string;
  intervalHours: number;
  enabled: boolean;
  revision: number;
  nextRunAt: string;
  createdAt: string;
  latest: WatchSnapshot | null;
}
export interface WatchSnapshot {
  id: string;
  watchId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  attempts: number;
  content: string | null;
  previousContent: string | null;
  change: 'baseline' | 'changed' | 'unchanged' | 'unknown';
  claimType: 'fact' | 'estimate' | 'analysis';
  method: 'web' | 'manual';
  note: string;
  price?: PriceObservation | null;
  previousPrice?: PriceObservation | null;
  error: string | null;
  sourceUrl: string;
  createdAt: string;
  completedAt: string | null;
  intelligenceId: string | null;
  candidateId?: string | null;
  candidateStatus?: import('./workflow.js').CandidateStatus | null;
}
export interface WatchDetail extends Watch {
  snapshots: WatchSnapshot[];
}
export const creativeTypeLabels = {
  drama: '短剧',
  showcase: '作品展示',
  tutorial: '教程',
  merchant: '门店营销',
  story: '体验故事',
  ad: '广告',
  topic: '话题',
  music: '音乐',
} as const;
export const dramaInput = z.object({
  product: productId,
  title: z.string().trim().min(2).max(200),
  platform: z.string().trim().min(1).max(80),
  market: marketSchema,
  genre: z.string().trim().max(200).nullable(),
  hook: z.string().trim().max(2000).nullable(),
  conflict: z.string().trim().max(4000).nullable(),
  reversal: z.string().trim().max(2000).nullable(),
  pacing: z.string().trim().max(2000).nullable(),
  narrative: z.string().trim().max(4000).nullable(),
  sourceUrl: webUrl,
  claimType: z.enum(['fact', 'estimate', 'analysis']),
  notes: z.string().trim().max(4000).default(''),
  creativeType: z
    .enum(
      Object.keys(creativeTypeLabels) as (keyof typeof creativeTypeLabels)[],
    )
    .optional(),
  vertical: verticalSchema.optional(),
  platformId: z.string().trim().max(200).optional(),
  author: z.string().trim().max(200).optional(),
  publishedAt: informationDate.nullable().optional(),
  marketBasis: z.string().trim().max(1000).optional(),
  mediaPermission: z
    .enum(['link_only', 'embed_allowed', 'licensed'])
    .optional(),
  transfer: z.string().trim().max(4000).optional(),
});
export const dramaEdit = z.object({
  revision: z.number().int().min(0),
  data: dramaInput.omit({ product: true }),
});
export const observationInput = z
  .object({
    sourceUrl: webUrl,
    observedAt: z.iso.datetime(),
    metric: z.enum(['rank', 'views', 'popularity', 'likes', 'comments']),
    value: z.number().finite().nonnegative().max(1e15),
    unit: z.string().trim().min(1).max(40),
    scope: z.string().trim().min(1).max(200),
    claimType: z.enum(['fact', 'estimate']),
    note: z.string().trim().max(1000).default(''),
    provider: z.string().trim().max(120).optional(),
    cached: z.boolean().optional(),
  })
  .refine(
    (v) => v.metric !== 'rank' || (Number.isInteger(v.value) && v.value >= 1),
    '排名必须为正整数',
  );
export interface Drama extends z.infer<typeof dramaInput> {
  id: string;
  revision: number;
  intelligenceId: string | null;
  createdAt: string;
  trend: DramaTrend;
  observations: DramaObservation[];
}
export interface DramaObservation extends z.infer<typeof observationInput> {
  id: string;
  createdAt: string;
}
export interface DramaTrend {
  state: 'unknown' | 'rising' | 'falling' | 'stable';
  label: string;
  detail: string;
  delta: number | null;
  unit: string | null;
  signal?: 'surge' | 'rank_up' | 'growth';
}
// Compare only matching source, metric, unit and scope. Estimated numbers never establish growth.
export function dramaTrend(
  observations: Pick<
    DramaObservation,
    | 'sourceUrl'
    | 'observedAt'
    | 'metric'
    | 'value'
    | 'unit'
    | 'scope'
    | 'claimType'
    | 'provider'
    | 'cached'
  >[],
): DramaTrend {
  const factual = observations
    .filter((o) => o.claimType === 'fact' && !o.cached)
    .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt));
  const latest = factual[0];
  const unknown = {
    state: 'unknown',
    label: '趋势未知',
    detail: '需要至少两次同来源、同指标、同口径的事实观测。',
    delta: null,
    unit: null,
  } as const;
  if (!latest) return unknown;
  const before = factual.find(
    (o) =>
      o.sourceUrl === latest.sourceUrl &&
      o.metric === latest.metric &&
      o.unit === latest.unit &&
      o.scope === latest.scope &&
      o.provider === latest.provider &&
      Date.parse(o.observedAt) < Date.parse(latest.observedAt),
  );
  if (!before) return unknown;
  const hours =
    (Date.parse(latest.observedAt) - Date.parse(before.observedAt)) / 3600000;
  const delta = latest.value - before.value;
  const rising = latest.metric === 'rank' ? delta < 0 : delta > 0;
  const surge =
    latest.metric === 'views' &&
    hours >= 2 &&
    hours <= 6 &&
    delta >= 20000 &&
    delta / Math.max(before.value, 1000) >= 0.5;
  return {
    state: delta === 0 ? 'stable' : rising ? 'rising' : 'falling',
    label: surge
      ? '监测样本中飙升'
      : delta === 0
        ? '持平'
        : rising
          ? latest.metric === 'rank'
            ? '榜单上升'
            : '观测上升'
          : '观测下降',
    detail: `${before.value} → ${latest.value} ${latest.unit}；间隔 ${hours.toFixed(2)} 小时${hours >= 0.5 && latest.metric !== 'rank' ? `，每小时变化 ${Math.round(delta / hours)} ${latest.unit}` : ''}。仅代表该来源和统计口径${surge ? '（播放增量阈值 v1）' : ''}。`,
    signal: surge
      ? 'surge'
      : rising
        ? latest.metric === 'rank'
          ? 'rank_up'
          : 'growth'
        : undefined,
    delta,
    unit: latest.unit,
  };
}
export const originalScriptInput = z.object({
  task: taskInput.refine((v) => v.kind === 'content', '原创脚本须使用选题任务'),
  brief: z.string().trim().min(20).max(6000),
});
export const observationImportInput = z.array(observationInput).min(1).max(50);
export function textDifference(before: string | null, after: string | null) {
  if (after === null)
    return { change: 'unknown' as const, added: [], removed: [] };
  if (before === null)
    return { change: 'baseline' as const, added: [], removed: [] };
  const a = before
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
    b = after
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  return {
    change: before === after ? ('unchanged' as const) : ('changed' as const),
    added: b.filter((s) => !a.includes(s)).slice(0, 80),
    removed: a.filter((s) => !b.includes(s)).slice(0, 80),
  };
}

export type DramaInput = z.infer<typeof dramaInput>;
export type ObservationInput = z.infer<typeof observationInput>;

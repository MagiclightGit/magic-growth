export const briefSections = {
  tattoo: '国外纹身行业',
  local: '美国本地服务',
  competitor: '竞品与 AI 广告视频',
  social: '社媒热点',
} as const;

export interface BriefEntry {
  id: string;
  section: keyof typeof briefSections;
  title: string;
  summary: string;
  sourceUrl: string;
  publishedAt: string | null;
  action: string;
}

export interface BriefContent {
  entries: BriefEntry[];
  leads: BriefEntry[];
  coverage: {
    name: string;
    state: 'succeeded' | 'failed' | 'pending' | 'unobserved';
    completedAt: string | null;
  }[];
}

export interface DailyBrief extends BriefContent {
  id: string;
  product: string;
  businessDate: string;
  windowStart: string;
  windowEnd: string;
  createdAt: string;
}

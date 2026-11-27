import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import type { FeedSource } from '@guangmo/contracts';
import { api, dateTime } from '@/lib/api';
import { Badge } from '@/components/ui/badge';

export function IntelligenceSourceHealth({ product }: { product?: string }) {
  const suffix = product ? '?' + new URLSearchParams({ product }) : '';
  const query = useQuery({
    queryKey: ['feed-sources', product ?? ''],
    queryFn: () => api<FeedSource[]>('/sources' + suffix),
    refetchInterval: 30000,
  });
  const sources = query.data ?? [];
  const enabled = sources.filter((source) => source.enabled);
  const failed = enabled.filter((source) => source.latest?.status === 'failed');
  const latest = sources
    .flatMap((source) => (source.lastSuccessAt ? [source.lastSuccessAt] : []))
    .sort()
    .at(-1);

  let status = '尚未登记来源';
  let variant: 'neutral' | 'info' | 'success' | 'warning' | 'danger' =
    'neutral';
  if (query.isPending) {
    status = '正在读取来源状态';
    variant = 'info';
  } else if (query.error) {
    status = '来源状态加载失败';
    variant = 'danger';
  } else if (sources.length && !enabled.length) {
    status = '定时采集已暂停';
    variant = 'warning';
  } else if (enabled.length) {
    status = `${enabled.length} 个来源已启用 · ${failed.length} 个最近运行失败`;
    variant = failed.length > 0 ? 'warning' : 'success';
  }

  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={variant}>{status}</Badge>
        {latest && (
          <span className="tabular-nums text-muted-foreground">
            最近成功 {dateTime(latest)}
          </span>
        )}
      </div>
      <Link
        className="font-medium text-primary hover:underline"
        to={'/settings' + suffix}
      >
        查看来源与运行记录
      </Link>
    </div>
  );
}

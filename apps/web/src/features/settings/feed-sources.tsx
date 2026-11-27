import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { toast } from 'sonner';
import {
  categoryLabels,
  marketLabels,
  verticalLabels,
  type CollectionRun,
  type FeedSource,
} from '@guangmo/contracts';
import { Field, SelectField } from '@/components/form-fields';
import { EmptyState, ErrorState, Loading } from '@/components/page-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  ProductField,
  ProductName,
  useProducts,
} from '@/features/products/product-context';
import { api, dateTime, post } from '@/lib/api';
import { memberQuery } from '@/lib/queries';

const runStatus = {
  queued: '排队中',
  running: '采集中',
  succeeded: '采集成功',
  failed: '采集失败',
};

function RunResult({ run }: { run: CollectionRun }) {
  return (
    <div className="space-y-1 text-sm">
      <p>
        {runStatus[run.status]} · {dateTime(run.completedAt ?? run.createdAt)}
        {run.status === 'succeeded' &&
          (run.added ? ` · 新增 ${run.added} 条` : ' · 无新增')}
      </p>
      {run.error && <p className="text-muted-foreground">{run.error}</p>}
    </div>
  );
}

function RunHistory({ sourceId }: { sourceId: string }) {
  const history = useQuery({
    queryKey: ['source-runs', sourceId],
    queryFn: () => api<CollectionRun[]>(`/sources/${sourceId}/runs`),
    refetchInterval: 5000,
  });
  if (history.isPending) return <Loading />;
  if (history.error)
    return (
      <ErrorState error={history.error} retry={() => void history.refetch()} />
    );
  if (!history.data.length)
    return <p className="text-sm text-muted-foreground">还没有采集记录。</p>;
  return (
    <ul className="space-y-3">
      {history.data.map((run) => (
        <li key={run.id}>
          <RunResult run={run} />
        </li>
      ))}
    </ul>
  );
}

export function FeedSources() {
  const [adding, setAdding] = useState(false);
  const [history, setHistory] = useState<FeedSource | null>(null);
  const { product, active } = useProducts();
  const client = useQueryClient();
  const member = useQuery(memberQuery);
  const admin = member.data?.role === 'admin';
  const query = useQuery({
    queryKey: ['feed-sources', product],
    queryFn: () =>
      api<FeedSource[]>(
        '/sources' + (product ? '?' + new URLSearchParams({ product }) : ''),
      ),
    refetchInterval: 5000,
  });
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['feed-sources'] });
    void client.invalidateQueries({ queryKey: ['source-runs'] });
  };
  const create = useMutation({
    mutationFn: (body: Record<string, FormDataEntryValue>) =>
      post('/sources', body),
    onSuccess: () => {
      setAdding(false);
      refresh();
      toast.success('来源已登记');
    },
    onError: (error) => toast.error(error.message),
  });
  const control = useMutation({
    mutationFn: ({ source, run }: { source: FeedSource; run: boolean }) =>
      run
        ? post(`/sources/${source.id}/runs`, {})
        : api(`/sources/${source.id}`, {
            method: 'PATCH',
            body: JSON.stringify({
              enabled: !source.enabled,
              revision: source.revision,
            }),
          }),
    onSuccess: (_data, { run }) => {
      refresh();
      toast.success(run ? '采集已排队' : '采集计划已更新');
    },
    onError: (error) => {
      refresh();
      toast.error(error.message);
    },
  });
  return (
    <section className="mb-8 space-y-4" aria-labelledby="source-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="source-heading" className="text-lg font-semibold">
          情报来源
        </h2>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link
              to={
                '/candidates' +
                (product ? '?' + new URLSearchParams({ product }) : '')
              }
            >
              查看候选情报
            </Link>
          </Button>
          {admin && (
            <Button
              disabled={!active.some((item) => !product || item.id === product)}
              onClick={() => setAdding(true)}
            >
              登记来源
            </Button>
          )}
        </div>
      </div>
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : !query.data.length ? (
        <EmptyState
          title="尚未配置来源"
          description="管理员可以登记允许采集的 RSS 或 Atom 订阅源。"
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {query.data.map((source) => {
            const running =
              source.latest?.status === 'queued' ||
              source.latest?.status === 'running';
            return (
              <article
                key={source.id}
                className="min-w-0 space-y-3 rounded-xl border bg-card p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="break-words font-medium">{source.name}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      <ProductName id={source.product} /> ·{' '}
                      {verticalLabels[source.vertical]} ·{' '}
                      {marketLabels[source.market]}
                    </p>
                  </div>
                  <Badge variant="outline">
                    {source.enabled
                      ? `每 ${source.intervalHours} 小时`
                      : '定时暂停'}
                  </Badge>
                </div>
                <a
                  className="block w-fit max-w-full truncate text-xs underline"
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  原始订阅源
                </a>
                {source.latest ? (
                  <RunResult run={source.latest} />
                ) : (
                  <p className="text-sm text-muted-foreground">尚未采集</p>
                )}
                {source.lastSuccessAt && (
                  <p className="text-xs text-muted-foreground">
                    最近成功 {dateTime(source.lastSuccessAt)}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setHistory(source)}
                  >
                    运行记录
                  </Button>
                  {admin &&
                    active.some((item) => item.id === source.product) && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={control.isPending || running}
                          onClick={() => control.mutate({ source, run: true })}
                        >
                          采集一次
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={control.isPending}
                          onClick={() => control.mutate({ source, run: false })}
                        >
                          {source.enabled ? '暂停定时' : '启用定时'}
                        </Button>
                      </>
                    )}
                </div>
              </article>
            );
          })}
        </div>
      )}
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="max-h-[90svh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>登记订阅源</DialogTitle>
            <DialogDescription>
              登记后可先采集一次，检查结果再启用定时。
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate(
                Object.fromEntries(new FormData(event.currentTarget)),
              );
            }}
          >
            <Field
              label="来源名称"
              name="name"
              minLength={2}
              maxLength={120}
              required
            />
            <Field
              label="RSS 或 Atom 地址"
              name="url"
              type="url"
              maxLength={2048}
              required
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <ProductField defaultValue={product} />
              <SelectField
                label="监测市场"
                name="market"
                options={marketLabels}
                defaultValue="Global"
              />
              <SelectField
                label="行业"
                name="vertical"
                options={verticalLabels}
              />
              <SelectField
                label="情报类型"
                name="category"
                options={categoryLabels}
              />
              <Field
                label="定时间隔（小时）"
                name="intervalHours"
                type="number"
                min={6}
                max={168}
                defaultValue={6}
                required
              />
            </div>
            <Field
              label="允许采集的依据"
              name="permissionNote"
              minLength={5}
              maxLength={500}
              required
            />
            <div className="flex justify-end">
              <Button disabled={create.isPending}>保存来源</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      {history && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setHistory(null);
          }}
        >
          <DialogContent className="max-h-[85svh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>运行记录</DialogTitle>
              <DialogDescription>{history.name}</DialogDescription>
            </DialogHeader>
            <RunHistory sourceId={history.id} />
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}

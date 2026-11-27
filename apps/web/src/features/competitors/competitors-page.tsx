import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  canWrite,
  claimTypeLabels,
  manualSnapshot,
  watchKinds,
  textDifference,
  type Watch,
  type WatchDetail,
  type WatchSnapshot,
} from '@guangmo/contracts';
import { api, post, dateTime } from '@/lib/api';
import { memberQuery } from '@/lib/queries';
import {
  ProductField,
  ProductName,
  useProducts,
} from '@/features/products/product-context';
import { Button } from '@/components/ui/button';
import { Field, SelectField } from '@/components/form-fields';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  PageHeading,
  Loading,
  ErrorState,
  EmptyState,
} from '@/components/page-state';
const snapshotLabel = {
  queued: '等待采集',
  running: '采集中',
  succeeded: '采集完成',
  failed: '采集失败',
};
const changeLabel = {
  baseline: '首次基线',
  changed: '有变化',
  unchanged: '无文本变化',
  unknown: '变化未知',
};
export default function CompetitorsPage() {
  const [params, setParams] = useSearchParams();
  const id = params.get('watch');
  const [creating, setCreating] = useState(false);
  const { product } = useProducts();
  const member = useQuery(memberQuery);
  const writable = canWrite(member.data?.role ?? 'viewer');
  const client = useQueryClient();
  const list = useQuery({
    queryKey: ['competitors'],
    queryFn: () => api<Watch[]>('/competitors'),
    refetchInterval: 5000,
  });
  const detail = useQuery({
    queryKey: ['competitor', id],
    queryFn: () => api<WatchDetail>(`/competitors/${id}`),
    enabled: !!id,
    refetchInterval: 5000,
  });
  const select = (id: string | null) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      if (id) n.set('watch', id);
      else n.delete('watch');
      return n;
    });
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['competitors'] });
    void client.invalidateQueries({ queryKey: ['competitor'] });
  };
  const create = useMutation({
    mutationFn: (body: unknown) => post<Watch>('/competitors', body),
    onSuccess: (w) => {
      setCreating(false);
      select(w.id);
      refresh();
      toast.success('监控已创建，后台开始采集');
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <>
      <PageHeading
        title="竞品监控"
        description="跟踪公开页面变化，核实后转为情报和任务。"
        action={
          writable && (
            <Button onClick={() => setCreating(true)}>添加监控</Button>
          )
        }
      />
      {list.isPending ? (
        <Loading />
      ) : list.error ? (
        <ErrorState error={list.error} />
      ) : !list.data.length ? (
        <EmptyState
          title="还没有监控对象"
          description="添加竞品页面，自动保存快照并比较变化。"
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {list.data.map((w) => (
            <Card key={w.id} className="gap-3 p-5 shadow-none">
              <div className="flex items-start justify-between gap-3">
                <button
                  onClick={() => select(w.id)}
                  className="text-left font-medium hover:underline"
                >
                  {w.name}
                </button>
                <Badge variant="outline">
                  {w.enabled ? '监控中' : '已暂停'}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                <ProductName id={w.product} /> · {w.market} ·{' '}
                {watchKinds[w.kind]}
              </p>
              <a
                href={w.url}
                target="_blank"
                rel="noreferrer"
                className="w-fit max-w-full truncate text-xs underline"
              >
                {w.url}
              </a>
              <p className="text-sm">
                {w.latest
                  ? `${snapshotLabel[w.latest.status]} · ${changeLabel[w.latest.change]}`
                  : '等待首次采集'}
              </p>
              {w.latest?.error && (
                <p className="line-clamp-2 text-xs text-destructive">
                  {w.latest.error}
                </p>
              )}
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  每 {w.intervalHours} 小时 · 下次 {dateTime(w.nextRunAt)}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => select(w.id)}
                >
                  查看变化
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-h-[90svh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>添加竞品监控</DialogTitle>
            <DialogDescription>
              每个页面独立保留历史；需登录或动态加载的内容可手工补录。
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              create.mutate({
                ...Object.fromEntries(f),
                intervalHours: Number(f.get('intervalHours')),
              });
            }}
          >
            <ProductField defaultValue={product} />
            <Field
              label="竞品 / 页面名称"
              name="name"
              required
              maxLength={120}
            />
            <Field label="来源页面" name="url" type="url" required />
            <div className="grid grid-cols-2 gap-3">
              <SelectField label="监控类型" name="kind" options={watchKinds} />
              <SelectField
                label="市场"
                name="market"
                options={{ US: '美国', UK: '英国', EU: '欧洲', Global: '全球' }}
              />
            </div>
            <Field
              label="采集间隔（小时）"
              name="intervalHours"
              type="number"
              defaultValue="24"
              min={1}
              max={168}
              required
            />
            <Button disabled={create.isPending}>创建监控</Button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!id}
        onOpenChange={(open) => {
          if (!open) select(null);
        }}
      >
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{detail.data?.name ?? '监控详情'}</DialogTitle>
            <DialogDescription>
              变化依据来自页面文本；页面更新不代表已确认的业务结论。
            </DialogDescription>
          </DialogHeader>
          {detail.isPending ? (
            <Loading />
          ) : detail.error ? (
            <ErrorState error={detail.error} />
          ) : (
            detail.data && (
              <WatchDetails
                watch={detail.data}
                writable={writable}
                refresh={refresh}
              />
            )
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
function WatchDetails({
  watch,
  writable,
  refresh,
}: {
  watch: WatchDetail;
  writable: boolean;
  refresh: () => void;
}) {
  const [manual, setManual] = useState(false);
  const [editing, setEditing] = useState(false);
  const action = useMutation({
    mutationFn: ({
      path,
      body,
      method = 'POST',
    }: {
      path: string;
      body: unknown;
      method?: string;
    }) => api(path, { method, body: JSON.stringify(body) }),
    onSuccess: () => {
      refresh();
      setManual(false);
      setEditing(false);
      toast.success('已保存');
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <>
      <a
        href={watch.url}
        target="_blank"
        rel="noreferrer"
        className="break-all text-sm underline"
      >
        查看原页面
      </a>
      {writable && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={
              action.isPending ||
              watch.snapshots.some(
                (s) =>
                  s.method === 'web' &&
                  ['queued', 'running'].includes(s.status),
              )
            }
            onClick={() =>
              action.mutate({
                path: `/competitors/${watch.id}/collect`,
                body: {},
              })
            }
          >
            立即采集 / 重试
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={action.isPending}
            onClick={() =>
              action.mutate({
                path: `/competitors/${watch.id}`,
                method: 'PATCH',
                body: { enabled: !watch.enabled, revision: watch.revision },
              })
            }
          >
            {watch.enabled ? '暂停监控' : '恢复监控'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setManual(!manual)}
          >
            手工补录
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setEditing(!editing)}
          >
            编辑监控
          </Button>
        </div>
      )}
      {editing && (
        <form
          className="space-y-3 rounded-lg border p-4"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            action.mutate({
              path: `/competitors/${watch.id}/config`,
              method: 'PATCH',
              body: {
                ...Object.fromEntries(f),
                revision: watch.revision,
                intervalHours: Number(f.get('intervalHours')),
              },
            });
          }}
        >
          <Field
            label="竞品 / 页面名称"
            name="name"
            defaultValue={watch.name}
            required
            minLength={2}
            maxLength={120}
          />
          <Field
            label="来源页面"
            name="url"
            type="url"
            defaultValue={watch.url}
            required
          />
          <SelectField
            label="监控类型"
            name="kind"
            options={watchKinds}
            defaultValue={watch.kind}
          />
          <SelectField
            label="市场"
            name="market"
            options={{ US: '美国', UK: '英国', EU: '欧洲', Global: '全球' }}
            defaultValue={watch.market}
          />
          <Field
            label="采集间隔（小时）"
            name="intervalHours"
            type="number"
            defaultValue={watch.intervalHours}
            min={1}
            max={168}
            required
          />
          <Button size="sm" disabled={action.isPending}>
            保存配置
          </Button>
        </form>
      )}
      {manual && (
        <form
          className="space-y-3 rounded-lg border p-4"
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            const raw = Object.fromEntries(form);
            const price =
              raw.priceAmount !== undefined && raw.priceAmount !== ''
                ? {
                    plan: raw.pricePlan,
                    locale: raw.priceLocale,
                    currency: raw.priceCurrency,
                    interval: raw.priceInterval,
                    amount: raw.priceAmount,
                  }
                : undefined;
            const parsed = manualSnapshot.safeParse({ ...raw, price });
            if (!parsed.success) {
              toast.error('请检查报价口径或采集记录');
              return;
            }
            action.mutate({
              path: `/competitors/${watch.id}/snapshots`,
              body: parsed.data,
            });
          }}
        >
          <SelectField
            label="内容性质"
            name="claimType"
            options={{
              fact: claimTypeLabels.fact,
              estimate: claimTypeLabels.estimate,
              analysis: claimTypeLabels.analysis,
            }}
          />
          <label className="block space-y-2 text-sm">
            <span>页面内容 / 观测记录</span>
            <Textarea
              name="content"
              required
              minLength={10}
              maxLength={30000}
              rows={6}
            />
          </label>
          <Field label="采集说明" name="note" maxLength={2000} />
          {watch.kind === 'pricing' && (
            <details className="space-y-3 rounded-md border p-3">
              <summary className="cursor-pointer text-sm">
                结构化报价（选填）
              </summary>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="套餐名称" name="pricePlan" maxLength={120} />
                <Field
                  label="地区语言"
                  name="priceLocale"
                  placeholder="en-US"
                />
                <Field label="币种" name="priceCurrency" placeholder="USD" />
                <Field
                  label="价格"
                  name="priceAmount"
                  type="number"
                  min={0}
                  step="any"
                />
                <SelectField
                  label="计费周期"
                  name="priceInterval"
                  options={{
                    monthly: '月付',
                    annual: '年付',
                    one_time: '一次性',
                  }}
                />
              </div>
            </details>
          )}
          <Button size="sm" disabled={action.isPending}>
            保存人工快照
          </Button>
        </form>
      )}
      <div className="space-y-4">
        {watch.snapshots.map((s) => (
          <Snapshot
            key={s.id}
            snapshot={s}
            watch={watch}
            writable={writable}
            refresh={refresh}
          />
        ))}
      </div>
    </>
  );
}
function Snapshot({
  snapshot: s,
  watch,
  writable,
  refresh,
}: {
  snapshot: WatchSnapshot;
  watch: Watch;
  writable: boolean;
  refresh: () => void;
}) {
  const diff = textDifference(s.previousContent, s.content);
  const publish = useMutation({
    mutationFn: () =>
      post<{ id: string }>(
        `/competitors/${watch.id}/snapshots/${s.id}/publish`,
        {},
      ),
    onSuccess: () => {
      refresh();
      toast.success('已确认入库，可在情报详情转任务');
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{snapshotLabel[s.status]}</Badge>
        <Badge variant="secondary">{changeLabel[s.change]}</Badge>
        <span className="text-xs text-muted-foreground">
          {claimTypeLabels[s.claimType]} ·{' '}
          {s.method === 'web' ? '网页采集' : '人工记录'} · 第 {s.attempts}{' '}
          次尝试
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        请求 {dateTime(s.createdAt)}
        {s.completedAt ? ` · 完成 ${dateTime(s.completedAt)}` : ''}
      </p>
      {s.error && (
        <p role="alert" className="text-sm text-destructive">
          {s.error} · 数据未知
        </p>
      )}
      {s.note && <p className="text-sm">{s.note}</p>}
      {s.price && (
        <p className="text-sm">
          {s.price.plan} · {s.price.locale} · {s.price.currency}{' '}
          {s.price.amount} ·{' '}
          {
            { monthly: '月付', annual: '年付', one_time: '一次性' }[
              s.price.interval
            ]
          }
          {s.previousPrice &&
            s.change === 'changed' &&
            `（原价 ${s.previousPrice.amount}）`}
          {s.previousPrice &&
            s.change === 'unknown' &&
            '（与上次口径不同，待核对）'}
        </p>
      )}
      {s.status === 'succeeded' && (
        <>
          <details>
            <summary className="cursor-pointer text-sm">
              查看前后差异与快照
            </summary>
            {s.change === 'changed' && (
              <div className="my-3 grid gap-3 sm:grid-cols-2">
                <div className="rounded border p-3 text-xs">
                  <p className="mb-2 font-medium">移除 / 修改前</p>
                  <pre className="whitespace-pre-wrap break-words">
                    {diff.removed.join('\n') || '无独立移除文本'}
                  </pre>
                </div>
                <div className="rounded border p-3 text-xs">
                  <p className="mb-2 font-medium">新增 / 修改后</p>
                  <pre className="whitespace-pre-wrap break-words">
                    {diff.added.join('\n') || '无独立新增文本'}
                  </pre>
                </div>
              </div>
            )}
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-3 text-xs">
                {s.previousContent ?? '无历史基线'}
              </pre>
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-3 text-xs">
                {s.content}
              </pre>
            </div>
          </details>
          <a
            href={s.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs underline"
          >
            来源证据
          </a>
          {s.intelligenceId ? (
            <Button asChild size="sm" variant="outline">
              <Link
                to={`/intelligence?product=${watch.product}&item=${s.intelligenceId}`}
              >
                查看情报 / 转任务
              </Link>
            </Button>
          ) : s.candidateId && s.candidateStatus ? (
            <Button asChild size="sm" variant="outline">
              <Link
                to={
                  '/candidates?' +
                  new URLSearchParams({
                    product: watch.product,
                    status: s.candidateStatus,
                    candidate: s.candidateId,
                  })
                }
              >
                查看候选审核
              </Link>
            </Button>
          ) : (
            writable &&
            s.method === 'manual' &&
            !s.price && (
              <Button
                size="sm"
                variant="outline"
                disabled={publish.isPending}
                onClick={() => publish.mutate()}
              >
                核实并确认入库
              </Button>
            )
          )}
        </>
      )}
    </section>
  );
}

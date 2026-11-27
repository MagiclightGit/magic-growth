import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  canWrite,
  creativeTypeLabels,
  verticalLabels,
  claimTypeLabels,
  dramaInput,
  observationInput,
  observationImportInput,
  originalScriptInput,
  type Drama,
  type Assignee,
  type ResearchDetail,
} from '@guangmo/contracts';
import { api, post, dateTime } from '@/lib/api';
import { memberQuery } from '@/lib/queries';
import {
  ProductField,
  ProductName,
  useProducts,
} from '@/features/products/product-context';
import { Field, SelectField } from '@/components/form-fields';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
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
const markets = { US: '美国', UK: '英国', EU: '欧洲', Global: '全球' };
const metricLabels = {
  rank: '排名',
  views: '播放量',
  popularity: '平台热度值',
  likes: '点赞',
  comments: '评论',
};
const structures = {
  genre: '题材',
  hook: '开场钩子',
  conflict: '冲突结构',
  reversal: '反转',
  pacing: '节奏',
  narrative: '叙事结构参考',
} as const;
export default function DramasPage() {
  const { product } = useProducts();
  const [params, setParams] = useSearchParams();
  const id = params.get('drama');
  const fromRun = params.get('fromRun');
  const report = useQuery({
    queryKey: ['research', fromRun],
    queryFn: () => api<ResearchDetail>(`/research/${fromRun}`),
    enabled: !!fromRun,
  });
  const [source, setSource] = useState<string>('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const member = useQuery(memberQuery);
  const writable = canWrite(member.data?.role ?? 'viewer');
  const client = useQueryClient();
  const [filter, setFilter] = useState('');
  const [kind, setKind] = useState('');
  const [rising, setRising] = useState(false);
  const list = useQuery({
    queryKey: ['dramas'],
    queryFn: () => api<Drama[]>('/dramas'),
  });
  const detail = useQuery({
    queryKey: ['drama', id],
    queryFn: () => api<Drama>(`/dramas/${id}`),
    enabled: !!id,
  });
  const select = (id: string | null) => {
    setEditing(false);
    setParams((p) => {
      const n = new URLSearchParams(p);
      if (id) n.set('drama', id);
      else n.delete('drama');
      return n;
    });
  };
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['dramas'] });
    void client.invalidateQueries({ queryKey: ['drama'] });
  };
  const save = useMutation({
    mutationFn: ({ data, existing }: { data: unknown; existing?: Drama }) =>
      existing
        ? api<Drama>(`/dramas/${existing.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ data, revision: existing.revision }),
          })
        : post<Drama>('/dramas', data),
    onSuccess: (d) => {
      refresh();
      setCreating(false);
      setEditing(false);
      select(d.id);
      toast.success('创意参考已保存');
    },
    onError: (e) => toast.error(e.message),
  });
  const rows = list.data?.filter(
    (d) =>
      (!kind || (d.creativeType ?? 'drama') === kind) &&
      (!rising || d.trend.state === 'rising') &&
      [d.title, d.platform, d.genre, d.market]
        .join(' ')
        .toLowerCase()
        .includes(filter.toLowerCase()),
  );
  return (
    <>
      <PageHeading
        title="热门视频与创意参考"
        description="记录作品、广告创意和短剧，比较热度观测并整理原创选题。"
        action={
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link to={`/research?product=${product ?? ''}&template=dramas`}>
                研究短剧趋势
              </Link>
            </Button>
            {writable && (
              <Button onClick={() => setCreating(true)}>添加参考</Button>
            )}
          </div>
        }
      />
      <nav aria-label="素材类型" className="mb-4 flex flex-wrap gap-1">
        {[['', '全部素材'], ...Object.entries(creativeTypeLabels)].map(
          ([value, label]) => (
            <Button
              key={value}
              size="sm"
              variant={kind === value ? 'secondary' : 'ghost'}
              aria-pressed={kind === value}
              onClick={() => setKind(value ?? '')}
            >
              {label}
            </Button>
          ),
        )}
      </nav>
      {fromRun && (
        <section className="mb-5 space-y-3 rounded-lg border bg-card p-4">
          <h2 className="text-sm font-medium">从研究整理参考</h2>
          {report.isPending ? (
            <Loading />
          ) : report.error ? (
            <ErrorState error={report.error} />
          ) : (
            report.data && (
              <>
                <p className="text-sm text-muted-foreground">
                  {report.data.goal}
                </p>
                <details>
                  <summary className="cursor-pointer text-sm">展开报告</summary>
                  <p className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap text-sm leading-7">
                    {report.data.result || '报告尚未完成'}
                  </p>
                </details>
                <div className="flex flex-wrap gap-2">
                  {report.data.events
                    .filter(
                      (e) =>
                        e.data?.kind === 'source' &&
                        /^https?:\/\//.test(e.data.url ?? ''),
                    )
                    .map((e) => (
                      <Button
                        key={e.id}
                        variant="outline"
                        size="sm"
                        disabled={!writable}
                        onClick={() => {
                          setSource(e.data?.url ?? '');
                          setCreating(true);
                        }}
                      >
                        以此来源添加：{e.message.slice(0, 40)}
                      </Button>
                    ))}
                </div>
                <Button asChild size="sm" variant="link">
                  <Link
                    to={`/research?product=${report.data.product ?? ''}&run=${fromRun}`}
                  >
                    返回完整研究
                  </Link>
                </Button>
              </>
            )
          )}
        </section>
      )}
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <Field
          label="搜索剧名 / 平台 / 题材 / 市场"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={rising}
            onChange={(e) => setRising(e.target.checked)}
          />
          只看观测上升
        </label>
      </div>
      {list.isPending ? (
        <Loading />
      ) : list.error ? (
        <ErrorState error={list.error} />
      ) : !rows?.length ? (
        <EmptyState
          title={filter || rising ? '没有匹配的短剧' : '还没有短剧参考'}
          description="从研究中发现短剧，核实来源后记录结构与观测数据。"
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b bg-muted/40 text-left">
              <tr>
                {[
                  '剧名 / 平台',
                  '产品 · 市场',
                  '题材',
                  '热度趋势',
                  '叙事参考',
                  '操作',
                ].map((t) => (
                  <th key={t} className="p-4 font-medium">
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id} className="border-b last:border-0">
                  <td className="max-w-64 p-4">
                    <button
                      className="text-left font-medium hover:underline"
                      onClick={() => select(d.id)}
                    >
                      {d.title}
                    </button>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {d.platform}
                    </p>
                  </td>
                  <td className="p-4">
                    <ProductName id={d.product} />
                    <p className="text-xs text-muted-foreground">
                      {markets[d.market]}
                    </p>
                  </td>
                  <td className="p-4">{d.genre || '未知'}</td>
                  <td className="p-4">
                    <Badge
                      variant={
                        d.trend.state === 'rising' ? 'default' : 'outline'
                      }
                    >
                      {d.trend.label}
                    </Badge>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {d.observations.length} 条观测
                    </p>
                  </td>
                  <td className="p-4">{d.narrative ? '已整理' : '待补充'}</td>
                  <td className="p-4">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => select(d.id)}
                    >
                      查看 / 转任务
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>添加短剧参考</DialogTitle>
            <DialogDescription>
              保留原始来源，未知字段可留空。
            </DialogDescription>
          </DialogHeader>
          <DramaForm
            product={product}
            sourceUrl={source}
            sourceNote={
              fromRun
                ? `整理自团队研究 ${fromRun}，须核实原始来源。`
                : undefined
            }
            busy={save.isPending}
            onSave={(data) => save.mutate({ data })}
          />
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
            <DialogTitle>{detail.data?.title ?? '短剧详情'}</DialogTitle>
            <DialogDescription>
              核实来源与结构，再转为原创任务。
            </DialogDescription>
          </DialogHeader>
          {detail.isPending ? (
            <Loading />
          ) : detail.error ? (
            <ErrorState error={detail.error} />
          ) : (
            detail.data &&
            (editing ? (
              <DramaForm
                existing={detail.data}
                busy={save.isPending}
                onSave={(data) => save.mutate({ data, existing: detail.data })}
              />
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <Badge variant="outline">
                    {claimTypeLabels[detail.data.claimType]}
                  </Badge>
                  <span className="text-sm">
                    {detail.data.platform} · {markets[detail.data.market]}
                  </span>
                  <a
                    href={detail.data.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm underline"
                  >
                    查看来源
                  </a>
                  {writable && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditing(true)}
                    >
                      编辑参考
                    </Button>
                  )}
                </div>
                <dl className="grid gap-4 sm:grid-cols-2">
                  {Object.entries(structures).map(([key, label]) => (
                    <div key={key} className="rounded-lg border p-4">
                      <dt className="text-xs text-muted-foreground">{label}</dt>
                      <dd className="mt-2 whitespace-pre-wrap text-sm leading-6">
                        {detail.data?.[key as keyof typeof structures] ||
                          '未知 / 待补充'}
                      </dd>
                    </div>
                  ))}
                </dl>
                {detail.data.notes && (
                  <p className="whitespace-pre-wrap text-sm">
                    {detail.data.notes}
                  </p>
                )}
                <Observations
                  drama={detail.data}
                  writable={writable}
                  refresh={refresh}
                />
                {writable && (
                  <ScriptForm drama={detail.data} refresh={refresh} />
                )}
              </>
            ))
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
function DramaForm({
  existing,
  product,
  busy,
  onSave,
  sourceUrl,
  sourceNote,
}: {
  existing?: Drama;
  sourceUrl?: string;
  sourceNote?: string;
  product?: string;
  busy: boolean;
  onSave: (data: unknown) => void;
}) {
  const [creativeType, setCreativeType] = useState(
    existing?.creativeType ?? 'drama',
  );
  const visibleStructures =
    creativeType === 'drama'
      ? Object.entries(structures)
      : Object.entries(structures).filter(
          ([key]) => !['conflict', 'reversal'].includes(key),
        );
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const raw: Record<string, unknown> = {
          ...Object.fromEntries(f),
          product: existing?.product ?? f.get('product'),
        };
        for (const key of Object.keys(structures))
          raw[key] = String(f.get(key) || '').trim() || null;
        raw.publishedAt = f.get('publishedAt') || null;
        raw.vertical = f.get('vertical') || undefined;
        const parsed = dramaInput.safeParse(raw);
        if (!parsed.success) {
          toast.error(parsed.error.issues[0]?.message ?? '请检查填写内容');
          return;
        }
        if (existing) {
          const { product: omit, ...data } = parsed.data;
          void omit;
          onSave(data);
        } else onSave(parsed.data);
      }}
    >
      {!existing && <ProductField defaultValue={product} />}
      <Field
        label={creativeType === 'drama' ? '剧名' : '素材标题'}
        name="title"
        defaultValue={existing?.title}
        required
        minLength={2}
        maxLength={200}
      />
      <label className="block space-y-2 text-sm">
        <span>素材类型</span>
        <select
          name="creativeType"
          className="h-9 w-full rounded-md border bg-background px-3"
          value={creativeType}
          onChange={(event) =>
            setCreativeType(event.target.value as typeof creativeType)
          }
        >
          {Object.entries(creativeTypeLabels).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="平台"
          name="platform"
          defaultValue={existing?.platform}
          required
          maxLength={80}
        />
        <SelectField
          label="市场"
          name="market"
          options={markets}
          defaultValue={existing?.market}
        />
      </div>
      <Field
        label="来源链接"
        name="sourceUrl"
        type="url"
        defaultValue={existing?.sourceUrl ?? sourceUrl}
        required
      />
      <SelectField
        label="内容性质"
        name="claimType"
        options={{
          fact: claimTypeLabels.fact,
          estimate: claimTypeLabels.estimate,
          analysis: claimTypeLabels.analysis,
        }}
        defaultValue={existing?.claimType ?? 'analysis'}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          label="行业"
          name="vertical"
          options={{ '': '未分类', ...verticalLabels }}
          defaultValue={existing?.vertical}
        />
        <Field
          label="平台原帖 ID"
          name="platformId"
          defaultValue={existing?.platformId}
          maxLength={200}
        />
        <Field
          label="作者"
          name="author"
          defaultValue={existing?.author}
          maxLength={200}
        />
        <Field
          label="原始发布时间"
          name="publishedAt"
          defaultValue={existing?.publishedAt ?? ''}
          placeholder="YYYY-MM-DD 或带时区的时间"
        />
        <Field
          label="市场依据"
          name="marketBasis"
          defaultValue={existing?.marketBasis}
          maxLength={1000}
        />
        <SelectField
          label="素材权限"
          name="mediaPermission"
          options={{
            link_only: '仅引用链接',
            embed_allowed: '允许嵌入',
            licensed: '已取得授权',
          }}
          defaultValue={existing?.mediaPermission ?? 'link_only'}
        />
      </div>
      {visibleStructures.map(([key, label]) => (
        <label key={key} className="block space-y-2 text-sm">
          <span>{label}</span>
          <Textarea
            name={key}
            defaultValue={existing?.[key as keyof typeof structures] ?? ''}
            rows={key === 'narrative' ? 4 : 2}
            maxLength={
              key === 'genre'
                ? 200
                : key === 'narrative' || key === 'conflict'
                  ? 4000
                  : 2000
            }
          />
        </label>
      ))}
      <label className="block space-y-2 text-sm">
        <span>原创迁移建议</span>
        <Textarea
          name="transfer"
          defaultValue={existing?.transfer}
          maxLength={4000}
          placeholder="适用行业、真实素材、CTA 和观察指标"
        />
      </label>
      <label className="block space-y-2 text-sm">
        <span>备注 / 核实说明</span>
        <Textarea
          name="notes"
          defaultValue={existing?.notes ?? sourceNote}
          maxLength={4000}
        />
      </label>
      <Button disabled={busy}>{busy ? '保存中…' : '保存参考'}</Button>
    </form>
  );
}
function Observations({
  drama,
  writable,
  refresh,
}: {
  drama: Drama;
  writable: boolean;
  refresh: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const navigate = useNavigate();
  const importBatch = useMutation({
    mutationFn: (data: unknown) =>
      post<{ added: number; duplicates: number }>(
        `/dramas/${drama.id}/observations/import`,
        data,
      ),
    onSuccess: (result) => {
      refresh();
      setImporting(false);
      toast.success(
        `已导入 ${result.added} 条观测，跳过 ${result.duplicates} 条重复观测`,
      );
    },
    onError: (error) => toast.error(error.message),
  });
  const submitCandidate = useMutation({
    mutationFn: () =>
      post<{ id: string; status: string }>(`/dramas/${drama.id}/candidate`, {}),
    onSuccess: (result) => {
      toast.success('已打开候选审核');
      void navigate(
        '/candidates?' +
          new URLSearchParams({
            product: drama.product,
            status: result.status,
            candidate: result.id,
          }),
      );
    },
    onError: (error) => toast.error(error.message),
  });
  const save = useMutation({
    mutationFn: (data: unknown) =>
      post(`/dramas/${drama.id}/observations`, data),
    onSuccess: () => {
      setAdding(false);
      refresh();
      toast.success('观测已记录');
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <section className="space-y-3 border-t pt-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">
          热度趋势 · {drama.trend.label}
        </h2>
        {writable && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAdding(!adding)}
          >
            记录观测
          </Button>
        )}
      </div>
      <p className="text-xs leading-6 text-muted-foreground">
        {drama.trend.detail}
      </p>
      {writable && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setImporting(!importing)}
          >
            导入观测
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={submitCandidate.isPending}
            onClick={() => submitCandidate.mutate()}
          >
            送候选审核
          </Button>
        </div>
      )}
      {importing && (
        <form
          className="space-y-3 rounded-lg border p-4"
          onSubmit={(event) => {
            event.preventDefault();
            const raw = String(
              new FormData(event.currentTarget).get('observations') ?? '',
            );
            let data: unknown;
            try {
              data = JSON.parse(raw);
            } catch {
              toast.error('请输入有效的 JSON 数组');
              return;
            }
            const parsed = observationImportInput.safeParse(data);
            if (!parsed.success) {
              toast.error(
                `请检查观测字段 ${parsed.error.issues[0]?.path.join('.') ?? ''}`,
              );
              return;
            }
            importBatch.mutate(parsed.data);
          }}
        >
          <label className="block space-y-2 text-sm">
            <span>已获准的观测数据（JSON，最多 50 条）</span>
            <Textarea
              name="observations"
              rows={5}
              required
              maxLength={100000}
              placeholder='[{"sourceUrl":"https://…","observedAt":"UTC 时间","metric":"views","value":100,"unit":"次","scope":"累计播放","claimType":"fact","provider":"数据提供方"}]'
            />
          </label>
          <Button size="sm" disabled={importBatch.isPending}>
            保存观测
          </Button>
        </form>
      )}
      {adding && (
        <form
          className="space-y-3 rounded-lg border p-4"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const parsed = observationInput.safeParse({
              ...Object.fromEntries(f),
              value: Number(f.get('value')),
              observedAt: new Date(String(f.get('observedAt'))).toISOString(),
              cached: f.get('cached') === 'on',
            });
            if (!parsed.success) {
              toast.error(parsed.error.issues[0]?.message ?? '请检查观测数据');
              return;
            }
            save.mutate(parsed.data);
          }}
        >
          <Field
            label="数据来源链接"
            name="sourceUrl"
            type="url"
            defaultValue={drama.sourceUrl}
            required
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="观测时间"
              name="observedAt"
              type="datetime-local"
              required
            />
            <SelectField label="指标" name="metric" options={metricLabels} />
            <Field
              label="数值"
              name="value"
              type="number"
              step="any"
              min={0}
              required
            />
            <Field
              label="单位"
              name="unit"
              placeholder="名 / 次 / 分"
              required
              maxLength={40}
            />
          </div>
          <Field
            label="统计口径"
            name="scope"
            placeholder="例如：平台美国日榜 / 累计播放量"
            required
            maxLength={200}
          />
          <SelectField
            label="数值性质"
            name="claimType"
            options={{ fact: '事实（可核验）', estimate: '估算' }}
          />
          <Field label="备注" name="note" maxLength={1000} />
          <Field label="数据提供方" name="provider" maxLength={120} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="cached" />
            缓存数据
          </label>
          <Button size="sm" disabled={save.isPending}>
            保存观测
          </Button>
        </form>
      )}
      <div className="space-y-2">
        {[...drama.observations]
          .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))
          .map((o) => (
            <div key={o.id} className="rounded-lg border p-3 text-xs">
              <div className="flex flex-wrap justify-between gap-2">
                <span>
                  {dateTime(o.observedAt)} · {metricLabels[o.metric]} {o.value}{' '}
                  {o.unit}
                </span>
                <a
                  href={o.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  来源证据
                </a>
              </div>
              <p className="mt-2 text-muted-foreground">
                {claimTypeLabels[o.claimType]} · {o.scope}
                {o.provider ? ` · ${o.provider}` : ''}
                {o.cached ? ' · 缓存' : ''}
                {o.note ? ` · ${o.note}` : ''}
              </p>
            </div>
          ))}
      </div>
    </section>
  );
}
function ScriptForm({ drama, refresh }: { drama: Drama; refresh: () => void }) {
  const [open, setOpen] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const members = useQuery({
    queryKey: ['drama-assignees', drama.product],
    queryFn: () => api<Assignee[]>(`/tasks/assignees?product=${drama.product}`),
    enabled: open,
  });
  const create = useMutation({
    mutationFn: (data: unknown) =>
      post<{ id: string }>(`/dramas/${drama.id}/script`, data),
    onSuccess: (t) => {
      setTaskId(t.id);
      setOpen(false);
      refresh();
      toast.success('原创脚本任务已创建');
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <section className="space-y-3 border-t pt-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={() => setOpen(!open)}>
          转原创脚本任务
        </Button>
        {drama.intelligenceId && (
          <Button variant="link" asChild>
            <Link
              to={`/intelligence?product=${drama.product}&item=${drama.intelligenceId}`}
            >
              关联情报
            </Link>
          </Button>
        )}
        {taskId && (
          <Button asChild>
            <Link to={`/tasks?product=${drama.product}&task=${taskId}`}>
              查看任务
            </Link>
          </Button>
        )}
      </div>
      {open &&
        (members.isPending ? (
          <Loading />
        ) : members.error ? (
          <ErrorState error={members.error} />
        ) : (
          <form
            className="space-y-3 rounded-lg border p-4"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const parsed = originalScriptInput.safeParse({
                brief: f.get('brief'),
                task: {
                  title: f.get('title'),
                  kind: 'content',
                  assigneeId: f.get('assigneeId'),
                  channel: f.get('channel'),
                  priority: f.get('priority'),
                  dueAt: f.get('dueAt')
                    ? new Date(String(f.get('dueAt'))).toISOString()
                    : null,
                },
              });
              if (!parsed.success) {
                toast.error(
                  parsed.error.issues[0]?.message ?? '请检查任务内容',
                );
                return;
              }
              create.mutate(parsed.data);
            }}
          >
            <Field
              label="任务名称"
              name="title"
              defaultValue={`原创脚本：${drama.title}`}
              required
              minLength={2}
              maxLength={200}
            />
            <label className="block space-y-2 text-sm">
              <span>原创方向与交付要求</span>
              <Textarea
                name="brief"
                rows={4}
                required
                minLength={20}
                maxLength={6000}
                defaultValue={drama.transfer || ''}
                placeholder="写明目标受众、产品、全新角色与情节方向、时长及审核要求。"
              />
            </label>
            <SelectField
              label="负责人"
              name="assigneeId"
              options={Object.fromEntries(
                (members.data ?? []).map((m) => [m.id, m.name]),
              )}
            />
            <Field label="渠道" name="channel" required maxLength={80} />
            <SelectField
              label="优先级"
              name="priority"
              options={{ normal: '普通', high: '高', low: '低' }}
            />
            <Field label="截止时间" name="dueAt" type="datetime-local" />
            <p className="text-xs text-muted-foreground">
              任务自动附上来源与结构参考。每条参考关联一个原创选题任务。
            </p>
            <Button disabled={create.isPending || !members.data?.length}>
              创建任务
            </Button>
          </form>
        ))}
    </section>
  );
}

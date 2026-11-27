import { ResearchDetailFrame } from '@/features/research/components/research-detail-frame';
import { ReportFollowUps } from '@/features/research-conversations/report-follow-ups';
import { lazy, Suspense, useState } from 'react';
import { ArrowLeft, ArrowUpRight, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  canWrite,
  claimTypeLabels,
  watchKinds,
  competitorProfileInput,
  competitorRelationship,
  competitorRelationshipLabels,
  type CompetitorProfile,
  type CompetitorProfileDetail,
  type CompetitorRunDetail,
  type CompetitorResearchRun,
  type CompetitorFinding,
} from '@guangmo/contracts';
import { api, post, dateTime } from '@/lib/api';
import { memberQuery, integrationQuery } from '@/lib/queries';
import {
  ProductField,
  ProductName,
  useProducts,
} from '@/features/products/product-context';
import { Field, SelectField } from '@/components/form-fields';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ResearchReport } from '@/components/research-report';
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
const PageWatches = lazy(() => import('./competitors-page'));
const statuses = {
  queued: '等待研究',
  running: '研究中',
  succeeded: '研究完成',
  failed: '研究未完成',
};
const changeLabels = {
  baseline: '首次基线',
  changed: '发现变化 · 待核实',
  unchanged: '未见明确变化',
  unknown: '变化未知',
};
export default function CompetitorResearchPage() {
  const [params, setParams] = useSearchParams();
  const id = params.get('competitor');
  const relationship = competitorRelationship.safeParse(
    params.get('relationship'),
  ).data;
  const mode = params.get('mode') ?? (params.has('watch') ? 'pages' : null);
  const { product } = useProducts();
  const [creating, setCreating] = useState(false);
  const member = useQuery(memberQuery);
  const writable = canWrite(member.data?.role ?? 'viewer');
  const client = useQueryClient();
  const list = useQuery({
    queryKey: ['competitor-profiles'],
    queryFn: () => api<CompetitorProfile[]>('/competitor-profiles'),
    refetchInterval: 5000,
    enabled: mode !== 'pages',
  });
  const detail = useQuery({
    queryKey: ['competitor-profile', id],
    queryFn: () => api<CompetitorProfileDetail>(`/competitor-profiles/${id}`),
    enabled: !!id,
    refetchInterval: 4000,
  });
  const select = (id: string | null) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      n.delete('batch');
      n.delete('view');
      if (id) n.set('competitor', id);
      else n.delete('competitor');
      return n;
    });
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['competitor-profiles'] });
    void client.invalidateQueries({ queryKey: ['competitor-profile'] });
    void client.invalidateQueries({ queryKey: ['competitor-run'] });
  };
  const create = useMutation({
    mutationFn: (data: unknown) =>
      post<CompetitorProfile>('/competitor-profiles', data),
    onSuccess: (p) => {
      setCreating(false);
      select(p.id);
      refresh();
      toast.success('竞品已添加');
    },
    onError: (e) => toast.error(e.message),
  });
  const profiles = (list.data ?? []).filter(
    (profile) =>
      !relationship ||
      (profile.relationship ?? 'unclassified') === relationship,
  );
  if (id && mode !== 'pages')
    return (
      <ResearchDetailFrame>
        <Button
          variant="ghost"
          className="-ml-2 h-7 w-fit shrink-0 text-xs"
          onClick={() =>
            setParams((p) => {
              const n = new URLSearchParams(p);
              n.delete('competitor');
              n.delete('batch');
              n.delete('view');
              return n;
            })
          }
        >
          <ArrowLeft className="size-4" />
          返回竞品监控
        </Button>
        {detail.isPending ? (
          <Loading />
        ) : detail.error ? (
          <ErrorState
            error={detail.error}
            retry={() => void detail.refetch()}
          />
        ) : (
          detail.data && (
            <>
              <div className="flex shrink-0 items-center justify-between gap-3">
                <div>
                  <h1 className="text-xl font-semibold tracking-tight">
                    {detail.data.name}
                  </h1>
                </div>
                <Button asChild variant="outline">
                  <a
                    href={detail.data.website}
                    target="_blank"
                    rel="noreferrer"
                  >
                    访问官网
                    <ArrowUpRight className="size-4" />
                  </a>
                </Button>
              </div>
              <ProfileDetails
                key={detail.data.id}
                profile={detail.data}
                writable={writable}
                refresh={refresh}
              />
            </>
          )
        )}
      </ResearchDetailFrame>
    );
  return (
    <>
      <div className="mb-5 flex gap-2">
        <Button
          variant={mode === 'pages' ? 'outline' : 'secondary'}
          onClick={() =>
            setParams((p) => {
              const n = new URLSearchParams(p);
              n.delete('mode');
              n.delete('watch');
              return n;
            })
          }
        >
          竞品研究
        </Button>
        <Button
          variant={mode === 'pages' ? 'secondary' : 'outline'}
          onClick={() =>
            setParams((p) => {
              const n = new URLSearchParams(p);
              n.set('mode', 'pages');
              n.delete('competitor');
              n.delete('batch');
              return n;
            })
          }
        >
          页面快照
        </Button>
      </div>
      {mode === 'pages' ? (
        <Suspense fallback={<Loading />}>
          <PageWatches />
        </Suspense>
      ) : (
        <>
          <PageHeading
            title="竞品监控"
            description="持续研究产品、定价、落地页、内容、广告与用户评价。"
            action={
              writable && (
                <Button onClick={() => setCreating(true)}>添加竞品</Button>
              )
            }
          />
          <nav
            aria-label="竞品关系"
            className="mb-4 flex flex-wrap gap-1 border-b pb-2"
          >
            {[
              ['all', '全部竞品'] as const,
              ...Object.entries(competitorRelationshipLabels),
            ].map(([value, label]) => (
              <Button
                key={value}
                size="sm"
                variant={
                  (relationship ?? 'all') === value ? 'secondary' : 'ghost'
                }
                aria-current={
                  (relationship ?? 'all') === value ? 'page' : undefined
                }
                onClick={() =>
                  setParams((current) => {
                    const next = new URLSearchParams(current);
                    if (value === 'all') next.delete('relationship');
                    else next.set('relationship', value);
                    return next;
                  })
                }
              >
                {label}
              </Button>
            ))}
          </nav>
          {list.isPending ? (
            <Loading />
          ) : list.error ? (
            <ErrorState error={list.error} />
          ) : !profiles.length ? (
            <EmptyState
              title={relationship ? '此分类暂无竞品' : '还没有关注的竞品'}
              description="添加竞品官网和关注重点，获取有来源的六维研究。"
            />
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {profiles.map((p) => (
                <section
                  className="space-y-4 rounded-xl border bg-card p-5"
                  key={p.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <button
                        className="text-left font-semibold hover:underline"
                        onClick={() => select(p.id)}
                      >
                        {p.name}
                      </button>
                      <p className="mt-1 text-xs text-muted-foreground">
                        <ProductName id={p.product} /> · {p.market} ·{' '}
                        {
                          competitorRelationshipLabels[
                            p.relationship ?? 'unclassified'
                          ]
                        }
                      </p>
                    </div>
                    <Badge variant="outline">
                      {p.enabled ? '定期研究' : '已暂停'}
                    </Badge>
                  </div>
                  <a
                    href={p.website}
                    target="_blank"
                    rel="noreferrer"
                    className="block w-fit max-w-full truncate text-xs underline"
                  >
                    {p.website}
                  </a>
                  <div className="grid grid-cols-3 gap-2">
                    {Object.entries(watchKinds).map(([key, label]) => {
                      const f = p.latest?.findings?.find(
                        (f) => f.dimension === key,
                      );
                      return (
                        <div
                          key={key}
                          className="rounded-md bg-muted/40 p-2 text-xs"
                        >
                          <p>{label}</p>
                          <p className="mt-1 text-muted-foreground">
                            {f
                              ? f.availability === 'unknown'
                                ? '数据未知'
                                : changeLabels[f.change]
                              : '待研究'}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">
                      {p.latest ? statuses[p.latest.status] : '尚未研究'} ·{' '}
                      {p.enabled ? `每 ${p.intervalHours} 小时` : '手动研究'}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => select(p.id)}
                    >
                      查看研究 / 变化
                    </Button>
                  </div>
                </section>
              ))}
            </div>
          )}
        </>
      )}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>添加竞品</DialogTitle>
            <DialogDescription>
              填写官网和关注重点，可补充定价、社媒、广告库或评价页面。
            </DialogDescription>
          </DialogHeader>
          <ProfileForm
            product={product}
            busy={create.isPending}
            onSave={(v) => create.mutate(v)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
function ProfileForm({
  existing,
  product,
  busy,
  onSave,
}: {
  existing?: CompetitorProfile;
  product?: string;
  busy: boolean;
  onSave: (v: unknown) => void;
}) {
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const raw = {
          ...Object.fromEntries(f),
          product: existing?.product ?? f.get('product'),
          intervalHours: Number(f.get('intervalHours')),
          enabled: f.get('enabled') === 'on',
          sources: String(f.get('sources') ?? '')
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean),
        };
        const parsed = competitorProfileInput.safeParse(raw);
        if (!parsed.success) {
          toast.error(parsed.error.issues[0]?.message ?? '请检查配置');
          return;
        }
        if (existing) {
          const { product: omit, ...data } = parsed.data;
          void omit;
          onSave({ revision: existing.revision, data });
        } else onSave(parsed.data);
      }}
    >
      {!existing && <ProductField defaultValue={product} />}
      <Field
        label="竞品名称"
        name="name"
        defaultValue={existing?.name}
        required
        minLength={2}
        maxLength={120}
      />
      <Field
        label="官网"
        name="website"
        type="url"
        defaultValue={existing?.website}
        required
      />
      <SelectField
        label="竞品关系"
        name="relationship"
        defaultValue={existing?.relationship ?? 'unclassified'}
        options={competitorRelationshipLabels}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          label="市场"
          name="market"
          defaultValue={existing?.market ?? 'Global'}
          options={{ Global: '全球', US: '美国', UK: '英国', EU: '欧洲' }}
        />
        <Field
          label="研究间隔（小时）"
          name="intervalHours"
          type="number"
          min={6}
          max={168}
          defaultValue={existing?.intervalHours ?? 24}
          required
        />
      </div>
      <label className="block space-y-2 text-sm">
        <span>关注重点</span>
        <Textarea
          name="focus"
          defaultValue={existing?.focus}
          rows={3}
          maxLength={3000}
          placeholder="例如：视频生成能力、套餐调整、欧美广告创意与付费用户反馈"
        />
      </label>
      <label className="block space-y-2 text-sm">
        <span>补充来源（每行一个链接，最多 10 个）</span>
        <Textarea
          name="sources"
          defaultValue={existing?.sources.join('\n')}
          rows={3}
          placeholder="定价页、官方社媒、公开广告库、评价平台"
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          name="enabled"
          type="checkbox"
          defaultChecked={existing?.enabled ?? false}
        />
        定期研究（使用已配置模型，产生调用费用）
      </label>
      <Button disabled={busy}>{busy ? '保存中…' : '保存竞品'}</Button>
    </form>
  );
}
function ProfileDetails({
  profile,
  writable,
  refresh,
}: {
  profile: CompetitorProfileDetail;
  writable: boolean;
  refresh: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [params, setParams] = useSearchParams();
  const selected = params.get('batch') ?? profile.latest?.id;
  const view = ['overview', 'report', 'sources', 'discussion'].includes(
    params.get('view') ?? '',
  )
    ? params.get('view')!
    : 'overview';
  const reportView = view === 'discussion' ? 'overview' : view;
  const changeView = (value: string) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        n.set('view', value);
        return n;
      },
      { replace: true },
    );
  const integrations = useQuery(integrationQuery);
  const ready =
    integrations.data?.agentConfigured && integrations.data.queueAvailable;
  const action = useMutation({
    mutationFn: ({
      path,
      body,
      method = 'POST',
    }: {
      path: string;
      body: unknown;
      method?: string;
    }) =>
      api<CompetitorResearchRun>(path, { method, body: JSON.stringify(body) }),
    onSuccess: (r) => {
      refresh();
      setEditing(false);
      if (r.competitorId)
        setParams((p) => {
          const n = new URLSearchParams(p);
          n.set('batch', r.id);
          return n;
        });
      toast.success('已提交');
    },
    onError: (e) => toast.error(e.message),
  });
  const run = useQuery({
    queryKey: ['competitor-run', profile.id, selected],
    queryFn: () =>
      api<CompetitorRunDetail>(
        `/competitor-profiles/${profile.id}/runs/${selected}`,
      ),
    enabled: !!selected,
    refetchInterval: (q) =>
      !q.state.data || ['queued', 'running'].includes(q.state.data.status)
        ? 3000
        : false,
  });
  const active = profile.runs.some((r) =>
    ['queued', 'running'].includes(r.status),
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div
        className={cn(
          'flex shrink-0 flex-wrap items-center justify-between gap-2 border-b pb-3',
          (chatOpen || view === 'discussion') && 'hidden xl:flex',
        )}
      >
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span>
            <ProductName id={profile.product} /> · {profile.market}
          </span>
          <Badge variant="outline">
            {profile.enabled
              ? `每 ${profile.intervalHours} 小时`
              : '定期研究已暂停'}
          </Badge>
          {profile.enabled && (
            <span className="text-xs text-muted-foreground">
              下次 {dateTime(profile.nextRunAt)}
            </span>
          )}
        </div>

        {writable && (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={action.isPending || active || !ready}
              onClick={() =>
                action.mutate({
                  path: `/competitor-profiles/${profile.id}/research`,
                  body: {},
                })
              }
            >
              {active ? '后台研究中' : '重新研究'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setEditing(!editing)}
            >
              监控设置
            </Button>
          </div>
        )}
      </div>
      {!ready && (
        <p className="text-sm text-muted-foreground">
          模型或后台执行尚未就绪，
          <Link className="underline" to="/settings">
            查看接入状态
          </Link>
          。
        </p>
      )}
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="max-h-[85svh] overflow-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>监控设置</DialogTitle>
            <DialogDescription>
              调整竞品资料、关注重点和研究频率。
            </DialogDescription>
          </DialogHeader>
          <ProfileForm
            key={profile.revision}
            existing={profile}
            busy={action.isPending}
            onSave={(body) =>
              action.mutate({
                path: `/competitor-profiles/${profile.id}`,
                method: 'PATCH',
                body,
              })
            }
          />
        </DialogContent>
      </Dialog>
      {profile.runs.length > 0 && (
        <label
          className={cn(
            'flex shrink-0 flex-wrap items-center gap-2 text-xs',
            (chatOpen || view === 'discussion') && 'hidden xl:flex',
          )}
        >
          <span>研究批次</span>
          <select
            className="h-9 w-full max-w-md rounded-md border bg-background px-3"
            value={selected ?? ''}
            onChange={(e) =>
              setParams((p) => {
                const n = new URLSearchParams(p);
                n.set('batch', e.target.value);
                return n;
              })
            }
          >
            {profile.runs.map((r) => (
              <option key={r.id} value={r.id}>
                {dateTime(r.createdAt)} · {statuses[r.status]}
              </option>
            ))}
          </select>
        </label>
      )}
      {!selected ? (
        <EmptyState
          title="等待首次研究"
          description="六个维度会逐一检查，无法取得的内容保留未知。"
        />
      ) : run.isPending ? (
        <Loading />
      ) : run.error ? (
        <ErrorState error={run.error} />
      ) : (
        run.data && (
          <>
            <div className="flex shrink-0 items-center justify-between gap-2 text-xs">
              <span className="text-muted-foreground">
                {statuses[run.data.status]}
                {run.data.completedAt
                  ? ` · ${dateTime(run.data.completedAt)}`
                  : ' · 后台执行中'}
              </span>
              <Button
                size="sm"
                variant={
                  chatOpen || view === 'discussion' ? 'secondary' : 'outline'
                }
                onClick={() => {
                  setChatOpen(!(chatOpen || view === 'discussion'));
                  if (view === 'discussion') changeView('overview');
                }}
              >
                <MessageSquare className="size-4" />
                {chatOpen || view === 'discussion' ? '收起追问' : '追问 Agent'}
              </Button>
            </div>
            {run.data.error && (
              <div className="space-y-2 rounded-lg border p-3">
                <p role="alert" className="text-sm text-destructive">
                  {run.data.error}
                </p>
                {writable && run.data.status === 'failed' && (
                  <Button
                    size="sm"
                    disabled={active || action.isPending || !ready}
                    onClick={() =>
                      action.mutate({
                        path: `/competitor-profiles/${profile.id}/runs/${run.data!.id}/retry`,
                        body: {},
                      })
                    }
                  >
                    重试未完成阶段
                  </Button>
                )}
              </div>
            )}
            <div
              className={cn(
                'grid min-h-0 flex-1 gap-4 overflow-hidden',
                (chatOpen || view === 'discussion') &&
                  'xl:grid-cols-[minmax(0,1fr)_380px]',
              )}
            >
              <section
                className={cn(
                  'flex min-h-0 min-w-0 flex-col',
                  (chatOpen || view === 'discussion') && 'hidden xl:flex',
                )}
                aria-label="研究结果"
              >
                <nav
                  aria-label="研究内容"
                  className="flex shrink-0 flex-wrap gap-1 border-b pb-2"
                >
                  {(
                    [
                      ['overview', '变化概览'],
                      ['report', '完整报告'],
                      ['sources', '来源与过程'],
                    ] as const
                  ).map(([value, label]) => (
                    <Button
                      key={value}
                      variant={reportView === value ? 'secondary' : 'ghost'}
                      size="sm"
                      aria-current={reportView === value ? 'page' : undefined}
                      onClick={() => changeView(value)}
                    >
                      {label}
                    </Button>
                  ))}
                </nav>
                <div
                  key={`${selected}-${reportView}`}
                  className="min-h-0 flex-1 overflow-y-auto overscroll-contain pt-4 pr-1"
                  tabIndex={0}
                  aria-label="研究结果正文"
                >
                  <div hidden={reportView !== 'sources'}>
                    <details open className="rounded-lg border p-4">
                      <summary className="cursor-pointer text-sm">
                        研究过程与来源
                      </summary>
                      <ol className="mt-3 space-y-3 text-sm">
                        {run.data.events.map((e) => (
                          <li key={e.id} className="flex gap-3">
                            <span className="shrink-0 text-muted-foreground">
                              {dateTime(e.createdAt)}
                            </span>
                            {e.data?.kind === 'source' && e.data.url ? (
                              <a
                                className="break-all underline"
                                href={e.data.url}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {e.message}
                              </a>
                            ) : (
                              <span>{e.message}</span>
                            )}
                          </li>
                        ))}
                      </ol>
                    </details>
                  </div>
                  {reportView === 'overview' && run.data.findings && (
                    <div className="space-y-4">
                      <section className="space-y-3" aria-label="本次研究结论">
                        <div>
                          <h2 className="text-base font-semibold">
                            本次研究结论
                          </h2>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {run.data.previous
                              ? '查看各维度变化，点击结论核查依据。'
                              : '首次研究，建立监控基线；尚不能判断前后变化。'}
                          </p>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                          {run.data.findings.map((f) => (
                            <button
                              key={f.dimension}
                              type="button"
                              className="rounded-xl border bg-card p-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring"
                              onClick={() =>
                                document
                                  .getElementById(`finding-${f.dimension}`)
                                  ?.scrollIntoView({ block: 'start' })
                              }
                            >
                              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                <span className="text-sm font-medium">
                                  {watchKinds[f.dimension]}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {f.availability === 'unknown'
                                    ? '数据未知'
                                    : changeLabels[f.change]}
                                </span>
                              </div>
                              <p className="line-clamp-2 text-sm leading-6 text-muted-foreground">
                                {f.summary}
                              </p>
                            </button>
                          ))}
                        </div>
                      </section>
                      {run.data.findings.map((f) => (
                        <FindingCard
                          key={f.dimension}
                          finding={f}
                          run={run.data!}
                          profile={profile}
                          writable={writable}
                          refresh={refresh}
                        />
                      ))}
                    </div>
                  )}
                  {(reportView === 'report' ||
                    (reportView === 'overview' && !run.data.findings)) &&
                    run.data.report && (
                      <section className="rounded-xl border bg-card p-5 sm:p-6">
                        <h2 className="mb-4 text-lg font-semibold">
                          完整研究报告
                          {run.data.status === 'running' ? '（生成中）' : ''}
                        </h2>
                        <div className="mt-3 min-w-0">
                          <ResearchReport
                            streaming={
                              run.data.status === 'running' &&
                              run.data.stage === 'research'
                            }
                          >
                            {run.data.report}
                          </ResearchReport>
                        </div>
                      </section>
                    )}
                  {reportView === 'report' && !run.data.report && (
                    <EmptyState
                      title="报告尚未生成"
                      description="研究进度可在来源与过程中查看。"
                    />
                  )}
                </div>
              </section>
              <aside
                className={cn(
                  'flex min-h-0 min-w-0 flex-col',
                  !chatOpen && view !== 'discussion' && 'hidden',
                )}
                aria-label="报告追问"
              >
                <Button
                  className="mb-2 h-7 shrink-0 xl:hidden"
                  variant="outline"
                  onClick={() => {
                    setChatOpen(false);
                    changeView('overview');
                  }}
                >
                  <ArrowLeft className="size-4" />
                  返回研究结果
                </Button>
                {run.data.status === 'succeeded' ? (
                  <ReportFollowUps
                    key={run.data.id}
                    compact
                    sourceKind="competitor"
                    sourceId={run.data.id}
                  />
                ) : (
                  <div className="rounded-xl border bg-card p-5 text-sm text-muted-foreground">
                    报告完成后，可在这里与 Agent 讨论。
                  </div>
                )}
              </aside>
            </div>
          </>
        )
      )}
    </div>
  );
}
function FindingCard({
  finding: f,
  run,
  profile,
  writable,
  refresh,
}: {
  finding: CompetitorFinding;
  run: CompetitorRunDetail;
  profile: CompetitorProfile;
  writable: boolean;
  refresh: () => void;
}) {
  const previous = run.previous?.findings?.find(
    (p) => p.dimension === f.dimension,
  );
  const published = run.published[f.dimension];
  const confirm = useMutation({
    mutationFn: () =>
      post(`/competitor-profiles/${profile.id}/runs/${run.id}/publish`, {
        dimension: f.dimension,
      }),
    onSuccess: () => {
      refresh();
      toast.success('已确认入库');
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <section
      id={`finding-${f.dimension}`}
      className="scroll-mt-3 space-y-3 rounded-xl border bg-card p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">{watchKinds[f.dimension]}</h3>
        <Badge variant="outline">
          {f.availability === 'unknown'
            ? '数据未知'
            : claimTypeLabels[f.claimType]}
        </Badge>
        <Badge variant={f.change === 'changed' ? 'default' : 'secondary'}>
          {changeLabels[f.change]}
        </Badge>
      </div>
      <div className={cn('grid gap-3', previous && 'sm:grid-cols-2')}>
        {previous && (
          <div className="rounded-lg bg-muted/35 p-3">
            <p className="mb-2 text-xs text-muted-foreground">
              此前 ·{' '}
              {run.previous?.completedAt
                ? dateTime(run.previous.completedAt)
                : '无成功基线'}
            </p>
            <p className="whitespace-pre-wrap text-sm leading-6">
              {previous?.summary ?? '首次研究，暂无历史记录。'}
            </p>
            {previous && (
              <p className="mt-2 text-xs text-muted-foreground">
                {claimTypeLabels[previous.claimType]}
              </p>
            )}
            {previous?.evidence.map((e, i) => (
              <a
                key={i}
                className="mt-2 block w-fit max-w-full break-all text-xs underline"
                href={e.url}
                target="_blank"
                rel="noreferrer"
              >
                历史依据：{e.title || e.url}
              </a>
            ))}
          </div>
        )}
        <div className="rounded-lg bg-muted/35 p-3">
          <p className="mb-2 text-xs text-muted-foreground">
            本次 · {run.completedAt ? dateTime(run.completedAt) : '研究中'}
          </p>
          <p className="whitespace-pre-wrap text-sm leading-6">{f.summary}</p>
        </div>
      </div>
      <div className="rounded-md border p-3">
        <p className="mb-1 text-xs font-medium">变化判断 · 分析判断，待核实</p>
        <p className="whitespace-pre-wrap text-sm leading-6">{f.comparison}</p>
      </div>
      <div className="space-y-2">
        {f.evidence.map((e, i) => (
          <div key={i} className="text-xs">
            <a
              className="break-all underline"
              href={e.url}
              target="_blank"
              rel="noreferrer"
            >
              {e.title || e.url}
            </a>
            <p className="mt-1 leading-5 text-muted-foreground">
              依据摘要：{e.basis}
            </p>
          </div>
        ))}
      </div>
      {published ? (
        <Button asChild variant="outline" size="sm">
          <Link
            to={`/intelligence?product=${profile.product}&item=${published}`}
          >
            查看情报 / 转任务
          </Link>
        </Button>
      ) : (
        writable &&
        f.availability === 'found' && (
          <Button
            size="sm"
            variant="outline"
            disabled={confirm.isPending}
            onClick={() => confirm.mutate()}
          >
            核实此维度并入库
          </Button>
        )
      )}
    </section>
  );
}

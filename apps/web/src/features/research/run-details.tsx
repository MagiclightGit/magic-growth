import { ReportFollowUps } from '@/features/research-conversations/report-follow-ups';
import { Link, useSearchParams } from 'react-router';
import { ArrowLeft, MessageSquare, LoaderCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { LegacyProduct } from '@/features/products/legacy-product';
import { ProductName } from '@/features/products/product-context';
import { CandidateWorkflow } from './candidate-workflow';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ResearchDetail } from '@guangmo/contracts';
import { ResearchReport } from '@/components/research-report';
import { api, dateTime } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Loading, ErrorState } from '@/components/page-state';

function eventLabel(message: string) {
  if (message === '后台研究已开始，关闭网页不会影响执行') return '开始研究';
  if (message === '研究完成，报告已保存，可由团队成员查看') return '研究完成';
  if (message.startsWith('完成工具步骤：')) return '网页搜索完成';
  if (message === '完成研究分析步骤') return '分析完成';
  return message;
}
const labels = {
  queued: '排队中',
  running: '研究中',
  succeeded: '已完成',
  failed: '未完成',
};
export function RunDetails({ id }: { id: string }) {
  const client = useQueryClient();
  const [chatOpen, setChatOpen] = useState(false);
  const [params, setParams] = useSearchParams();
  const view = ['report', 'sources', 'activity', 'workflow'].includes(
    params.get('researchView') ?? '',
  )
    ? params.get('researchView')!
    : 'report';
  const changeView = (value: string) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        next.set('researchView', value);
        return next;
      },
      { replace: true },
    );
  const [connected, setConnected] = useState(false);
  const q = useQuery({
    queryKey: ['research', id],
    queryFn: () => api<ResearchDetail>(`/research/${id}`),
    refetchInterval: (query) =>
      !connected &&
      ['queued', 'running'].includes(query.state.data?.status ?? '')
        ? 3000
        : false,
  });
  const [now, setNow] = useState(() => Date.now());
  const status = q.data?.status;
  const active = status === 'queued' || status === 'running';
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  useEffect(() => {
    if (!active) return;
    const stream = new EventSource(`/api/research/${id}/stream`);
    stream.onopen = () => setConnected(true);
    stream.onerror = () => setConnected(false);
    stream.onmessage = (event) => {
      try {
        const run = JSON.parse(event.data) as ResearchDetail;
        if (run.id !== id || !Array.isArray(run.events)) return;
        client.setQueryData(['research', id], run);
        if (run.status === 'succeeded' || run.status === 'failed') {
          stream.close();
          void client.invalidateQueries({ queryKey: ['research'] });
          void client.invalidateQueries({ queryKey: ['overview'] });
        }
      } catch {
        setConnected(false);
      }
    };
    return () => {
      stream.close();
      setConnected(false);
    };
  }, [id, active, client]);
  if (q.isPending) return <Loading />;
  if (q.error)
    return <ErrorState error={q.error} retry={() => void q.refetch()} />;
  const run = q.data;
  const startedAt =
    run.events.find((event) => event.message === '开始研究')?.createdAt ??
    run.createdAt;
  const seconds = Math.max(
    0,
    Math.floor(
      ((active ? now : Date.parse(run.completedAt ?? run.createdAt)) -
        Date.parse(startedAt)) /
        1000,
    ),
  );
  const sources = run.events.filter(
    (event) =>
      event.data?.kind === 'source' &&
      /^https?:\/\//i.test(event.data.url ?? ''),
  );
  const heading = run.goal.split(/[｜|\n]/)[0]!.trim();
  const title = heading.length > 90 ? `${heading.slice(0, 90)}…` : heading;
  const events = run.events.filter((event) => event.data?.kind !== 'source');
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="line-clamp-2 text-lg font-semibold tracking-tight sm:text-xl">
            {title}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {run.product && <ProductName id={run.product} />}
            <span>{dateTime(run.createdAt)}</span>
          </p>
        </div>
        {run.status === 'succeeded' && run.product && (
          <Button
            size="sm"
            variant={chatOpen ? 'secondary' : 'outline'}
            className="shrink-0"
            onClick={() => setChatOpen(!chatOpen)}
          >
            <MessageSquare className="size-4" />
            {chatOpen ? '收起追问' : '追问 Agent'}
          </Button>
        )}
      </div>
      <div
        className="flex shrink-0 flex-wrap items-center gap-3 text-xs"
        role="status"
      >
        <Badge variant="outline">{labels[run.status]}</Badge>
        {active ? (
          <>
            <span className="inline-flex items-center gap-2 text-muted-foreground">
              <LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" />
              {eventLabel(events.at(-1)?.message ?? '等待开始研究')}
            </span>
            <span className="text-muted-foreground tabular-nums">
              已等待 {Math.floor(seconds / 60)}:
              {String(seconds % 60).padStart(2, '0')} ·{' '}
              {connected ? '实时更新' : '正在同步进度…'}
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">
            {run.completedAt
              ? `完成 ${dateTime(run.completedAt)}`
              : '本次研究尚未完成'}
          </span>
        )}
      </div>
      <div
        className={cn(
          'grid min-h-0 flex-1 gap-4 overflow-hidden',
          chatOpen && 'xl:grid-cols-[minmax(0,1fr)_380px]',
        )}
      >
        <section
          className={cn(
            'flex min-h-0 min-w-0 flex-col',
            chatOpen && 'hidden xl:flex',
          )}
          aria-label="研究结果"
        >
          <nav
            aria-label="研究内容"
            className="flex shrink-0 flex-wrap gap-1 border-b pb-2"
          >
            {(
              [
                ['report', '研究报告'],
                ['sources', `参考来源 · ${sources.length}`],
                ['activity', '执行过程'],
                ['workflow', '整理情报'],
              ] as const
            ).map(([value, label]) => (
              <Button
                key={value}
                size="sm"
                variant={view === value ? 'secondary' : 'ghost'}
                aria-current={view === value ? 'page' : undefined}
                onClick={() => changeView(value)}
              >
                {label}
              </Button>
            ))}
          </nav>
          <div
            key={view}
            className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain pt-4 pr-1"
            tabIndex={0}
            aria-label="研究结果正文"
          >
            {run.error && (
              <p
                role="alert"
                className="rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive"
              >
                {run.status === 'queued'
                  ? '本次连接中断，正在重试。'
                  : '研究中断，以下内容可能不完整。可返回研究记录重新发起。'}
              </p>
            )}
            {view === 'report' && title !== run.goal && (
              <details className="rounded-lg border px-4 py-3 text-sm">
                <summary className="cursor-pointer text-muted-foreground">
                  研究问题
                </summary>
                <p className="mt-3 whitespace-pre-wrap leading-6">{run.goal}</p>
              </details>
            )}
            {view === 'report' &&
              (run.result ? (
                <section className="min-w-0 rounded-xl border bg-card p-5 text-sm leading-7 sm:p-6">
                  <h2 className="mb-4 font-semibold">
                    {active
                      ? '报告生成中'
                      : run.status === 'failed'
                        ? '未完成的报告'
                        : '研究报告'}
                  </h2>
                  <ResearchReport streaming={active}>
                    {run.result}
                  </ResearchReport>
                </section>
              ) : (
                <div className="rounded-xl border bg-card p-6">
                  <h2 className="font-medium">
                    {active
                      ? run.status === 'queued'
                        ? '等待开始研究'
                        : '正在检索与分析'
                      : '本次未生成报告'}
                  </h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {active
                      ? '报告将在生成后显示，可离开页面稍后查看。'
                      : '请查看执行过程了解本次研究状态。'}
                  </p>
                  <Button
                    className="mt-3"
                    size="sm"
                    variant="outline"
                    onClick={() => changeView('activity')}
                  >
                    查看执行过程
                  </Button>
                </div>
              ))}
            {view === 'sources' && (
              <section
                aria-label="参考来源"
                className="rounded-xl border bg-card p-5"
              >
                <h2 className="mb-4 font-semibold">
                  参考来源 · {sources.length}
                </h2>
                {sources.length ? (
                  <ol className="space-y-3">
                    {sources.map((source) => (
                      <li key={source.id}>
                        <a
                          href={source.data?.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block w-fit max-w-full break-words text-sm underline underline-offset-4"
                        >
                          {source.data?.title || source.message}
                        </a>
                        <p className="mt-1 break-all text-xs text-muted-foreground">
                          {source.data?.url}
                        </p>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {active
                      ? '来源会随研究过程更新。'
                      : '本次没有保存可核查的来源。'}
                  </p>
                )}
              </section>
            )}
            {view === 'activity' && (
              <section className="rounded-xl border bg-card p-5">
                <h2 className="mb-4 font-semibold">执行过程</h2>
                <ol className="space-y-3">
                  {events.length ? (
                    events.map((event) => (
                      <li
                        key={event.id}
                        className="flex flex-wrap items-start justify-between gap-2 border-b pb-3 text-sm"
                      >
                        <span className="min-w-0 break-words">
                          {eventLabel(event.message)}
                        </span>
                        <time className="shrink-0 text-xs text-muted-foreground">
                          {dateTime(event.createdAt)}
                        </time>
                      </li>
                    ))
                  ) : (
                    <li className="text-sm text-muted-foreground">等待开始</li>
                  )}
                </ol>
              </section>
            )}
            {view === 'workflow' && (
              <div className="space-y-4">
                <div>
                  <h2 className="font-semibold">整理为团队情报</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    从报告提取候选条目，核实后再入库或转为任务。
                  </p>
                </div>
                {run.product === null && (
                  <LegacyProduct id={run.id} kind="research" />
                )}
                <CandidateWorkflow runId={id} researchStatus={run.status} />
                {run.status !== 'succeeded' && (
                  <p className="text-sm text-muted-foreground">
                    报告完成后可整理候选情报。
                  </p>
                )}
                {run.status === 'succeeded' &&
                  run.product &&
                  /短剧|short.?drama|reelshort|dramabox/i.test(run.goal) && (
                    <Button asChild variant="outline">
                      <Link to={`/dramas?product=${run.product}&fromRun=${id}`}>
                        整理为短剧参考
                      </Link>
                    </Button>
                  )}
              </div>
            )}
          </div>
        </section>
        <aside
          aria-label="报告追问"
          className={cn('flex min-h-0 min-w-0 flex-col', !chatOpen && 'hidden')}
        >
          <Button
            className="mb-2 h-7 w-fit shrink-0 xl:hidden"
            variant="outline"
            onClick={() => setChatOpen(false)}
          >
            <ArrowLeft className="size-4" />
            返回研究结果
          </Button>
          {run.status === 'succeeded' && run.product && (
            <ReportFollowUps compact sourceKind="research" sourceId={id} />
          )}
        </aside>
      </div>
    </div>
  );
}

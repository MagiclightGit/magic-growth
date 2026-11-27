import { ProductName } from '@/features/products/product-context';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownToLine, ArrowRight, FileText, Plus } from 'lucide-react';
import { overviewQuery } from '@/lib/queries';
import { dateTime } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  EmptyState,
  ErrorState,
  Loading,
  PageHeading,
} from '@/components/page-state';
import { categoryLabels } from '@guangmo/contracts';

const runStatusMeta = {
  queued: { label: '排队中', variant: 'neutral' as const },
  running: { label: '研究中', variant: 'info' as const },
  succeeded: { label: '已完成', variant: 'success' as const },
  failed: { label: '失败', variant: 'danger' as const },
};

export default function OverviewPage() {
  const query = useQuery(overviewQuery);
  if (query.isPending) return <Loading />;
  if (query.error)
    return (
      <ErrorState error={query.error} retry={() => void query.refetch()} />
    );
  const data = query.data;
  const metrics = [
    {
      label: '情报总量',
      value: data.total,
      to: '/intelligence',
      hint: '查看收件箱',
    },
    {
      label: '待确认情报',
      value: data.pending,
      to: '/intelligence?view=history&status=pending',
      hint: data.pending > 0 ? '待团队核实' : '暂无积压',
      highlight: data.pending > 0,
    },
    {
      label: '已确认有效',
      value: data.verified,
      to: '/intelligence?view=today',
      hint: '查看已核实项',
    },
    {
      label: '研究运行',
      value: data.runs,
      to: '/research',
      hint: '手动与定时研究',
    },
  ];

  return (
    <>
      <PageHeading
        title="工作台概览"
        description="汇总当前授权产品范围内的情报积压与近期研究进展。"
        action={
          <>
            <Button variant="outline" asChild>
              <Link to="/briefs">
                <FileText className="size-3.5" />
                今日简报
              </Link>
            </Button>
            <Button asChild>
              <Link to="/research">
                <Plus className="size-3.5" />
                发起研究
              </Link>
            </Button>
          </>
        }
      />

      <section
        aria-label="核心计数"
        className="mb-4 grid grid-cols-2 divide-y rounded-lg border bg-card sm:grid-cols-4 sm:divide-x sm:divide-y-0"
      >
        {metrics.map((metric) => (
          <Link
            key={metric.label}
            to={metric.to}
            className="group flex flex-col justify-between px-4 py-3 transition-colors hover:bg-primary-soft/35"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                {metric.label}
              </span>
              <ArrowRight className="size-3.5 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
            </div>
            <div className="mt-1.5 flex items-baseline justify-between gap-2">
              <span
                className={
                  metric.highlight
                    ? 'text-2xl font-semibold tracking-tight tabular-nums text-status-warning-fg'
                    : 'text-2xl font-semibold tracking-tight tabular-nums text-foreground'
                }
              >
                {metric.value}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {metric.hint}
              </span>
            </div>
          </Link>
        ))}
      </section>

      <div className="grid gap-4 xl:grid-cols-[1.55fr_1fr]">
        <section className="overflow-hidden rounded-lg border bg-card">
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <h2 className="text-sm font-semibold text-foreground">最新情报</h2>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/intelligence" className="text-primary">
                查看全部
                <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          </div>
          {data.recentItems.length ? (
            <div className="divide-y">
              {data.recentItems.map((item) => (
                <Link
                  to={`/intelligence?item=${item.id}`}
                  key={item.id}
                  className="block px-4 py-3 transition-colors hover:bg-primary-soft/30"
                >
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <Badge variant="info">
                      {categoryLabels[item.category]}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      <ProductName id={item.product} /> · {item.market}
                    </span>
                  </div>
                  <p className="text-[13px] font-medium text-foreground">
                    {item.title}
                  </p>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                    {item.summary}
                  </p>
                </Link>
              ))}
            </div>
          ) : (
            <div className="p-4">
              <EmptyState
                title="暂无情报"
                description="录入或采集线索后，已核实情报会显示在这里。"
                action={
                  <Button size="sm" variant="outline" asChild>
                    <Link to="/intelligence">
                      <ArrowDownToLine className="size-3.5" />
                      进入情报收件箱
                    </Link>
                  </Button>
                }
              />
            </div>
          )}
        </section>

        <section className="overflow-hidden rounded-lg border bg-card">
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <h2 className="text-sm font-semibold text-foreground">研究动态</h2>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/research" className="text-primary">
                全部研究
                <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          </div>
          {data.recentRuns.length ? (
            <div className="divide-y">
              {data.recentRuns.map((run) => {
                const meta = runStatusMeta[run.status];
                return (
                  <Link
                    to={`/research?run=${run.id}`}
                    key={run.id}
                    className="block px-4 py-3 transition-colors hover:bg-primary-soft/30"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {dateTime(run.createdAt)}
                      </span>
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-[13px] text-foreground">
                      {run.goal}
                    </p>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="p-4">
              <EmptyState
                title="还没有研究任务"
                description="发起一次 Agent 研究，系统将在后台持续收集来源并整理候选。"
              />
            </div>
          )}
        </section>
      </div>
    </>
  );
}

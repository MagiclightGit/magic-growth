import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { briefSections, type DailyBrief } from '@guangmo/contracts';
import {
  EmptyState,
  ErrorState,
  Loading,
  PageHeading,
} from '@/components/page-state';
import { Button } from '@/components/ui/button';
import { ProductName, useProducts } from '@/features/products/product-context';
import { api } from '@/lib/api';

const shanghai = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const health = {
  succeeded: '成功',
  failed: '失败',
  pending: '待完成',
  unobserved: '窗口内无运行',
};

export default function BriefsPage() {
  const { product } = useProducts();
  const [params, setParams] = useSearchParams();
  const filter = product ? '?' + new URLSearchParams({ product }) : '';
  const query = useQuery({
    queryKey: ['briefs', product],
    queryFn: () => api<DailyBrief[]>('/briefs' + filter),
    refetchInterval: 60000,
  });
  const edition =
    query.data?.find((brief) => brief.id === params.get('edition')) ??
    query.data?.[0];
  return (
    <>
      <PageHeading
        title="每日情报简报"
        description="北京时间每天 09:05 生成站内简报。"
        action={
          <Button variant="outline" asChild>
            <Link to={'/intelligence' + filter}>返回收件箱</Link>
          </Button>
        }
      />
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : !edition ? (
        <EmptyState title="暂无简报" description="第一期生成后会显示在这里。" />
      ) : (
        <div className="max-w-4xl space-y-5">
          <label className="flex flex-wrap items-center gap-3 text-sm">
            选择期次
            <select
              className="h-10 max-w-full rounded-md border bg-background px-3"
              value={edition.id}
              onChange={(event) =>
                setParams((current) => {
                  const next = new URLSearchParams(current);
                  next.set('edition', event.target.value);
                  return next;
                })
              }
            >
              {query.data.map((brief) => (
                <option key={brief.id} value={brief.id}>
                  {brief.businessDate} · {brief.product}
                </option>
              ))}
            </select>
          </label>
          <article className="space-y-5 rounded-xl border bg-card p-5 sm:p-7">
            <div>
              <h2 className="text-xl font-semibold">
                <ProductName id={edition.product} /> · {edition.businessDate}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {shanghai.format(new Date(edition.windowStart))} 至{' '}
                {shanghai.format(new Date(edition.windowEnd))}（北京时间） ·
                人工核验
              </p>
            </div>
            {Object.entries(briefSections).map(([key, label]) => {
              const entries = edition.entries.filter(
                (entry) => entry.section === key,
              );
              return (
                <section className="space-y-2 border-t pt-3" key={key}>
                  <h3 className="font-semibold">{label}</h3>
                  {entries.length ? (
                    <ul className="space-y-3">
                      {entries.map((entry) => (
                        <li key={entry.id} className="space-y-1 text-sm">
                          <Link
                            className="font-medium underline underline-offset-4"
                            to={
                              '/intelligence?' +
                              new URLSearchParams({
                                product: edition.product,
                                item: entry.id,
                              })
                            }
                          >
                            {entry.title}
                          </Link>
                          <p>{entry.summary}</p>
                          <a
                            href={entry.sourceUrl}
                            className="text-muted-foreground underline"
                            target="_blank"
                            rel="noreferrer"
                          >
                            原始来源
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      暂无已核实新信息
                    </p>
                  )}
                </section>
              );
            })}
            {!!edition.leads.length && (
              <section className="space-y-2 border-t pt-3">
                <h3 className="font-semibold">补充线索</h3>
                {edition.leads.map((entry) => (
                  <p key={entry.id} className="text-sm">
                    <a
                      href={entry.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      {entry.title}
                    </a>{' '}
                    · 原始时间未知
                  </p>
                ))}
              </section>
            )}
            {edition.entries.some((entry) => entry.action) && (
              <section className="space-y-2 border-t pt-3">
                <h3 className="font-semibold">今天建议做</h3>
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {edition.entries
                    .filter((entry) => entry.action)
                    .slice(0, 3)
                    .map((entry) => (
                      <li key={entry.id}>{entry.action}</li>
                    ))}
                </ul>
              </section>
            )}
            <details className="border-t pt-3 text-sm">
              <summary className="cursor-pointer">
                订阅源覆盖 ·{' '}
                {
                  edition.coverage.filter(
                    (source) => source.state === 'succeeded',
                  ).length
                }
                /{edition.coverage.length} 成功
              </summary>
              {edition.coverage.length ? (
                <ul className="mt-2 space-y-1">
                  {edition.coverage.map((source, index) => (
                    <li key={index}>
                      {source.name} · {health[source.state]}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-muted-foreground">
                  该产品暂无启用的订阅源。
                </p>
              )}
              <p className="mt-2 text-muted-foreground">
                社媒覆盖取决于已导入并核验的数据。
              </p>
            </details>
          </article>
        </div>
      )}
    </>
  );
}

import { ResearchDetailFrame } from './components/research-detail-frame';
import { ProductField, useProducts } from '@/features/products/product-context';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpRight,
  Clock3,
  ArrowLeft,
  LoaderCircle,
  Search,
  Sparkles,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { RunDetails } from './run-details';
import { toast } from 'sonner';
import { canWrite, type ResearchRun } from '@guangmo/contracts';
import { integrationQuery, memberQuery, researchQuery } from '@/lib/queries';
import { post, dateTime } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardContent, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

import {
  EmptyState,
  Loading,
  ErrorState,
  PageHeading,
} from '@/components/page-state';
const labels = {
  queued: '排队中',
  running: '研究中',
  succeeded: '已完成',
  failed: '失败',
};
export default function ResearchPage() {
  const { product } = useProducts();
  const [researchProduct, setResearchProduct] = useState(product);
  const [goal, setGoal] = useState(() =>
    new URLSearchParams(window.location.search).get('template') === 'dramas'
      ? '研究最近一周美国、英国、欧洲市场的热门与热度上升短剧。逐条记录剧名、平台、市场、题材、开场钩子、冲突结构、反转、节奏与叙事结构参考，附原始来源及发布时间。热度必须给出可核验的榜单或播放数据、观测时间、统计口径及原链接；无法取得标记未知，区分事实、估算和分析判断，不凭主观印象称为飙升。提出原创改编方向，避免复制具体情节、台词或素材。'
      : '',
  );
  const [params, setParams] = useSearchParams();
  const selected = params.get('run');
  const setSelected = (id: string | null) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('researchView');
      if (id) next.set('run', id);
      else next.delete('run');
      return next;
    });
  const client = useQueryClient();
  const integrations = useQuery(integrationQuery);
  const member = useQuery(memberQuery);
  const runs = useQuery(researchQuery);
  const writable = canWrite(member.data?.role ?? 'viewer');
  const configured =
    integrations.data?.agentConfigured && integrations.data.queueAvailable;
  const create = useMutation({
    mutationFn: () =>
      post<ResearchRun>('/research', { goal, product: researchProduct }),
    onSuccess: (run) => {
      setGoal('');
      setSelected(run.id);
      void client.invalidateQueries({ queryKey: ['research'] });
      void client.invalidateQueries({ queryKey: ['overview'] });
      toast.success('研究已创建');
    },
    onError: (error) => toast.error(error.message),
  });
  if (selected)
    return (
      <ResearchDetailFrame>
        <Button
          variant="ghost"
          className="-ml-2 h-7 w-fit shrink-0 text-xs"
          onClick={() => setSelected(null)}
        >
          <ArrowLeft className="size-4" />
          返回研究记录
        </Button>
        <RunDetails key={selected} id={selected} />
      </ResearchDetailFrame>
    );
  return (
    <>
      <PageHeading
        title="Agent 研究"
        description="输入问题，获取有来源的研究报告。"
        action={
          <Button variant="outline" asChild>
            <Link to="/schedules">
              <Clock3 className="size-4" />
              定时研究
            </Link>
          </Button>
        }
      />
      {params.get('template') === 'dramas' && (
        <p className="mb-5 text-sm text-muted-foreground">
          报告完成后核实来源，在{' '}
          <Link className="underline" to={`/dramas?product=${product ?? ''}`}>
            短剧参考
          </Link>{' '}
          整理结构与观测；需要每天研究，可在定时研究中使用本页目标。
        </p>
      )}
      <div className="grid gap-6">
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="size-4" />
              开始一次研究
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                create.mutate();
              }}
            >
              <div className="mb-4">
                <ProductField
                  defaultValue={researchProduct}
                  onChange={setResearchProduct}
                />
              </div>
              <Label htmlFor="goal" className="mb-3">
                研究目标
              </Label>
              <Textarea
                id="goal"
                className="min-h-36 resize-y leading-7"
                placeholder="例如：美国纹身师常用哪些 AI 工具？对比功能、价格与来源。"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                minLength={10}
                maxLength={2000}
                required
              />
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  可离开页面，稍后查看结果。
                </p>
                <Button
                  disabled={
                    !configured ||
                    !writable ||
                    !researchProduct ||
                    create.isPending
                  }
                >
                  {create.isPending ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <Search className="size-4" />
                  )}
                  开始研究
                </Button>
              </div>
            </form>
            {integrations.error ? (
              <p className="mt-5 text-sm text-destructive">
                无法获取接入状态，请刷新重试。
              </p>
            ) : (
              integrations.data &&
              !configured && (
                <div className="mt-5 rounded-lg border bg-muted/40 p-4">
                  <p className="text-sm font-medium">研究服务尚未就绪</p>
                  <p className="mt-2 text-xs leading-6 text-muted-foreground">
                    {!integrations.data.agentConfigured
                      ? '模型与搜索服务尚未配置。'
                      : '研究执行暂时不可用。'}
                  </p>
                  <Button
                    size="sm"
                    variant="link"
                    className="mt-1 px-0"
                    asChild
                  >
                    <Link to="/settings">
                      查看接入状态
                      <ArrowUpRight className="size-3" />
                    </Link>
                  </Button>
                </div>
              )
            )}
          </CardContent>
        </Card>
      </div>
      <div className="mt-8 mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold">研究记录</h2>
      </div>
      {runs.isPending ? (
        <Loading />
      ) : runs.error ? (
        <ErrorState error={runs.error} />
      ) : runs.data.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {runs.data.map((run) => (
            <button
              key={run.id}
              className="rounded-xl border bg-card p-5 text-left transition-colors hover:bg-accent/40"
              onClick={() => setSelected(run.id)}
            >
              <div className="flex items-center justify-between">
                <Badge variant="outline">{labels[run.status]}</Badge>
                <ArrowUpRight className="size-3.5 text-muted-foreground" />
              </div>
              <p className="mt-4 line-clamp-3 text-sm font-medium leading-6">
                {run.goal}
              </p>
              <p className="mt-4 text-xs text-muted-foreground">
                {dateTime(run.createdAt)}
              </p>
            </button>
          ))}
        </div>
      ) : (
        <EmptyState
          title="还没有研究记录"
          description="输入问题，开始第一次研究。"
        />
      )}
    </>
  );
}

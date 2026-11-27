import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  scoreBand,
  scoreContext,
  scoreKeys,
  scoreLabels,
  scoreWeights,
  type OpportunityScore,
  type ScoreContext,
  type ScoreTarget,
} from '@guangmo/contracts';
import { post, dateTime } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

export function ScoreSummary({ score }: { score?: OpportunityScore | null }) {
  if (!score)
    return <span className="text-xs text-muted-foreground">未评分</span>;
  if (score.status === 'queued' || score.status === 'running')
    return <Badge variant="secondary">评分中</Badge>;
  if (score.status === 'failed')
    return <Badge variant="outline">评分未完成</Badge>;
  const total = score.calculation?.total;
  const excluded = score.windowEnded || score.excluded;
  return (
    <div className="space-y-1">
      <Badge variant="outline">
        {score.stale
          ? '待复核'
          : excluded
            ? '不再适用'
            : total == null
              ? '待补评'
              : `机会 ${total}`}
      </Badge>
      <p className="text-xs text-muted-foreground">
        {score.windowEnded
          ? '行动窗口已结束'
          : score.excluded
            ? '暂不进入执行队列'
            : score.stale
              ? '内容变化或评估已过期'
              : total == null
                ? `已评估权重 ${score.calculation?.coverage ?? 0}%`
                : score.proposal?.evidenceGrade === 'B'
                  ? scoreBand(total)
                  : '待补证'}
      </p>
    </div>
  );
}
export function OpportunityScorePanel({
  score,
  type,
  id,
  writable,
}: {
  score?: OpportunityScore | null;
  type: ScoreTarget;
  id: string;
  writable: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [context, setContext] = useState<ScoreContext>(
    score?.context ?? scoreContext.parse({}),
  );
  const client = useQueryClient();
  const request = useMutation({
    mutationFn: () => post(`/scoring/${type}/${id}`, { context }),
    onSuccess: () => {
      setOpen(false);
      toast.success('评分已提交，后台完成后会自动更新');
      for (const key of [
        'candidates',
        'candidate-batch',
        'intelligence',
        'intelligence-detail',
      ])
        void client.invalidateQueries({ queryKey: [key] });
    },
    onError: (error) => toast.error(error.message),
  });
  const busy = score?.status === 'queued' || score?.status === 'running';
  return (
    <section className="mt-4 space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-medium">机会评估</h3>
          <ScoreSummary score={score} />
        </div>
        {writable && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setContext(score?.context ?? scoreContext.parse({}));
              setOpen(true);
            }}
          >
            {score ? '补充背景 / 重新评估' : '评估机会'}
          </Button>
        )}
      </div>
      {!score && (
        <p className="text-xs text-muted-foreground">
          尚未评估。补充目标和执行条件后，可获取评分建议。
        </p>
      )}
      {busy && (
        <p className="text-xs text-muted-foreground">
          后台正在评估，关闭页面后仍会继续。
        </p>
      )}
      {score?.status === 'failed' && (
        <p role="alert" className="break-words text-xs text-destructive">
          {score.error ?? '评分未完成，请重试。'}
        </p>
      )}
      {score?.proposal && (
        <>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {scoreKeys.map((key) => (
              <div key={key} className="rounded-md bg-muted/40 p-2">
                <dt className="text-xs text-muted-foreground">
                  {scoreLabels[key]}
                </dt>
                <dd className="mt-1 text-sm font-medium tabular-nums">
                  {score.proposal!.dimensions[key].value === null
                    ? '待补充'
                    : `${score.proposal!.dimensions[key].value} / 4`}
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-xs leading-6 text-muted-foreground">
            证据 {score.proposal.evidenceGrade} ·{' '}
            {score.proposal.evidenceReason}
          </p>
          <details>
            <summary className="cursor-pointer text-xs">
              评分依据与待补项
            </summary>
            <dl className="mt-3 space-y-3">
              {scoreKeys.map((key) => (
                <div key={key}>
                  <dt className="text-xs font-medium">
                    {scoreLabels[key]} · {scoreWeights[key]}% ·{' '}
                    {score.proposal!.dimensions[key].value === null
                      ? '未知'
                      : `${score.proposal!.dimensions[key].value}/4`}
                  </dt>
                  <dd className="mt-1 whitespace-pre-wrap text-xs leading-6 text-muted-foreground">
                    {score.proposal!.dimensions[key].reason}
                    {score.proposal!.dimensions[key].sourceIndices.length >
                      0 && (
                      <span>
                        （依据来源{' '}
                        {score
                          .proposal!.dimensions[key].sourceIndices.map(
                            (i) => i + 1,
                          )
                          .join('、')}
                        ）
                      </span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
            {score.proposal.gaps.length > 0 && (
              <ul className="mt-3 list-disc space-y-1 pl-4 text-xs leading-6 text-muted-foreground">
                {score.proposal.gaps.map((gap, i) => (
                  <li key={i}>{gap}</li>
                ))}
              </ul>
            )}
            {score.calculation?.total === null && (
              <p className="mt-3 text-xs text-muted-foreground">
                缺项未计分，补齐后才生成总分。理论范围 {score.calculation.lower}
                –{score.calculation.upper}，不代表成功概率。
              </p>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              AI 建议，未经人工评分复核 ·{' '}
              {score.evaluatedAt ? dateTime(score.evaluatedAt) : ''}
            </p>
          </details>
        </>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90svh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>评估机会</DialogTitle>
            <DialogDescription>
              只填写已知背景。未知项可留空，模型会保留待补评状态。
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              request.mutate();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor={`goal-${id}`}>增长目标</Label>
              <Textarea
                id={`goal-${id}`}
                maxLength={1000}
                value={context.growthGoal}
                onChange={(e) =>
                  setContext({ ...context, growthGoal: e.target.value })
                }
                placeholder="例如：验证美国独立纹身师的获客选题"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`audience-${id}`}>目标客户</Label>
              <Input
                id={`audience-${id}`}
                maxLength={500}
                value={context.audience}
                onChange={(e) =>
                  setContext({ ...context, audience: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`action-${id}`}>计划行动</Label>
              <Textarea
                id={`action-${id}`}
                maxLength={1000}
                value={context.action}
                onChange={(e) =>
                  setContext({ ...context, action: e.target.value })
                }
                placeholder="包含渠道、验证方法和衡量指标"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`days-${id}`}>已确认的准备周期（天）</Label>
              <Input
                id={`days-${id}`}
                type="number"
                min={0}
                max={365}
                step={1}
                value={context.preparationDays ?? ''}
                onChange={(e) =>
                  setContext({
                    ...context,
                    preparationDays:
                      e.target.value === '' ? null : Number(e.target.value),
                  })
                }
              />
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input
                className="mt-1"
                type="checkbox"
                checked={context.resourcesConfirmed}
                onChange={(e) =>
                  setContext({
                    ...context,
                    resourcesConfirmed: e.target.checked,
                  })
                }
              />
              我已核实该行动所需的素材、渠道与团队资源
            </label>
            <p className="text-xs text-muted-foreground">
              后台评估会调用模型。相同内容和背景在当天复用已有结果。
            </p>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                取消
              </Button>
              <Button disabled={request.isPending}>
                {request.isPending ? '提交中…' : '开始评估'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}

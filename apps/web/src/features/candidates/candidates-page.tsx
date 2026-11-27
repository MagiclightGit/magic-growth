import { ProductName } from '@/features/products/product-context';
import { OpportunityScorePanel } from '@/components/opportunity-score';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  canWrite,
  candidateStatus,
  candidateStatusLabels as labels,
  verticalLabels,
  type CandidateReviewInput,
  categoryLabels,
  claimTypeLabels,
  type Candidate,
  type CandidateInput,
  type IntelligenceListItem,
} from '@guangmo/contracts';
import { api, post } from '@/lib/api';
import { memberQuery } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  PageHeading,
  EmptyState,
  Loading,
  ErrorState,
} from '@/components/page-state';
import {
  InformationTimes,
  SourceTimeDetails,
} from '@/components/information-times';
import { CandidateEditor } from './candidate-editor';
import { cn } from '@/lib/utils';

const candidateStatusVariant = {
  pending: 'warning' as const,
  needs_evidence: 'danger' as const,
  approved: 'success' as const,
  rejected: 'neutral' as const,
};
const reviewLabels = {
  approve: '确认通过',
  request_evidence: '要求补证',
  reject: '拒绝线索',
  merge: '合并到已有情报',
} as const;
type ReviewRequest = {
  candidate: Candidate;
  action: CandidateReviewInput['action'];
};
export default function CandidatesPage() {
  const [params, setParams] = useSearchParams();
  const status =
    candidateStatus.safeParse(params.get('status')).data ?? 'pending';
  const product = params.get('product') ?? '';
  const candidateId = params.get('candidate') ?? '';
  const [reviewing, setReviewing] = useState<ReviewRequest | null>(null);
  const runId = params.get('run') ?? '';
  const [editing, setEditing] = useState<Candidate | null>(null);
  const client = useQueryClient();
  const member = useQuery(memberQuery);
  const targets = useQuery({
    queryKey: ['candidate-merge-targets', reviewing?.candidate.product],
    queryFn: () =>
      api<IntelligenceListItem[]>(
        '/intelligence?' +
          new URLSearchParams({
            product: reviewing!.candidate.product,
            status: 'verified',
          }),
      ),
    enabled: reviewing?.action === 'merge',
  });
  const writable = canWrite(member.data?.role ?? 'viewer');
  const query = useQuery({
    queryKey: ['candidates', status, runId, product, candidateId],
    queryFn: () =>
      api<Candidate[]>(
        `/candidates?${new URLSearchParams({ status, runId, ...(product ? { product } : {}), ...(candidateId ? { id: candidateId } : {}) })}`,
      ),
    refetchInterval: 5000,
  });
  const invalidate = () => {
    for (const key of [
      'candidates',
      'candidate-batch',
      'intelligence',
      'intelligence-detail',
      'overview',
    ])
      void client.invalidateQueries({ queryKey: [key] });
  };
  const review = useMutation({
    mutationFn: ({
      candidate,
      action,
      reason,
      targetId,
    }: ReviewRequest & { reason?: string; targetId?: string }) =>
      post(`/candidates/${candidate.id}/review`, {
        revision: candidate.revision,
        action,
        reason,
        targetId,
      }),
    onSuccess: () => {
      setReviewing(null);
      invalidate();
      toast.success('审核已保存');
    },
    onError: (error) => {
      invalidate();
      toast.error(error.message);
    },
  });
  const edit = useMutation({
    mutationFn: (payload: CandidateInput) =>
      api(`/candidates/${editing!.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          revision: editing!.revision,
          candidate: payload,
        }),
      }),
    onSuccess: () => {
      setEditing(null);
      invalidate();
      if (status === 'needs_evidence') {
        setParams((current) => {
          const next = new URLSearchParams(current);
          next.set('status', 'pending');
          return next;
        });
      }
      toast.success('修改已保存');
    },
    onError: (error) => toast.error(error.message),
  });
  return (
    <>
      <PageHeading
        title="候选情报"
        description="查看来源证据，审核后加入情报收件箱。"
        action={
          <Button variant="outline" asChild>
            <Link
              to={
                product
                  ? `/settings?${new URLSearchParams({ product })}`
                  : '/settings'
              }
            >
              查看采集来源
            </Link>
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-3 pt-1">
        <nav aria-label="审核状态" className="flex flex-wrap gap-1">
          {Object.entries(labels).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-current={value === status ? 'page' : undefined}
              className={cn(
                '-mb-px border-b-2 px-3 py-2 text-[13px] transition-colors',
                value === status
                  ? 'border-primary font-medium text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
              onClick={() =>
                setParams((current) => {
                  const next = new URLSearchParams(current);
                  next.set('status', value);
                  next.delete('candidate');
                  return next;
                })
              }
            >
              {label}
            </button>
          ))}
        </nav>
        {runId && (
          <div className="flex items-center gap-2 pb-1">
            <Button size="sm" variant="outline" asChild>
              <Link to={`/research?run=${runId}`}>查看研究</Link>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                setParams({ status, ...(product ? { product } : {}) })
              }
            >
              查看全部研究
            </Button>
          </div>
        )}
      </div>
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : query.data.length ? (
        <div className="space-y-3">
          {query.data.map((candidate) => (
            <article
              key={candidate.id}
              className="rounded-lg border bg-card p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={candidateStatusVariant[candidate.status]}>
                  {labels[candidate.status]}
                </Badge>
                <Badge variant="info">
                  {candidate.runId
                    ? 'Agent 研究'
                    : candidate.collectionRunId
                      ? '来源采集'
                      : candidate.origin === 'competitor'
                        ? '竞品页面变化'
                        : candidate.origin === 'social'
                          ? '社媒观测'
                          : '人工线索'}
                </Badge>
                <Badge variant="neutral">
                  {claimTypeLabels[candidate.claimType]}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  <ProductName id={candidate.product} /> · {candidate.market} ·{' '}
                  {categoryLabels[candidate.category]}
                  {candidate.vertical &&
                    ` · ${verticalLabels[candidate.vertical]}`}
                </span>
              </div>
              <h2 className="mt-3 text-base font-semibold">
                {candidate.title}
              </h2>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-7">
                {candidate.summary}
              </p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span>语言：{candidate.language ?? '未知'}</span>
                {candidate.tags.map((tag) => (
                  <Badge key={tag} variant="outline">
                    {tag}
                  </Badge>
                ))}
              </div>
              <div className="mt-3">
                <InformationTimes
                  primaryUrl={candidate.sources[0]!.url}
                  value={candidate}
                  collectedAt={candidate.createdAt}
                />
              </div>
              {candidate.reviewReason && (
                <p className="mt-3 text-sm">
                  审核备注：{candidate.reviewReason}
                </p>
              )}
              <details className="mt-4 rounded-lg border p-3">
                <summary className="cursor-pointer text-sm">
                  来源与依据 · {candidate.sources.length}
                </summary>
                <ul className="mt-3 space-y-4">
                  {candidate.sources.map((source, index) => (
                    <li key={index}>
                      <a
                        className="break-all text-sm underline underline-offset-4"
                        href={source.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {source.title || source.url}
                      </a>
                      <p className="mt-1 whitespace-pre-wrap text-xs leading-6 text-muted-foreground">
                        {source.evidence || '缺少原文摘录'}
                      </p>
                      <SourceTimeDetails
                        value={candidate.sourceTimes?.find(
                          (time) => time.url === source.url,
                        )}
                      />
                    </li>
                  ))}
                </ul>
              </details>
              {candidate.suggestedAction && (
                <p className="mt-3 text-sm text-muted-foreground">
                  建议行动：{candidate.suggestedAction}
                </p>
              )}
              <OpportunityScorePanel
                score={candidate.scoring}
                type="candidate"
                id={candidate.id}
                writable={writable}
              />
              <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                {candidate.runId && (
                  <Button size="sm" variant="ghost" asChild>
                    <Link to={`/research?run=${candidate.runId}`}>原研究</Link>
                  </Button>
                )}
                {candidate.intelligenceId && (
                  <Button size="sm" variant="outline" asChild>
                    <Link
                      to={
                        '/intelligence?' +
                        new URLSearchParams({
                          item: candidate.intelligenceId,
                          view: 'history',
                          ...(product ? { product } : {}),
                        })
                      }
                    >
                      查看情报
                    </Link>
                  </Button>
                )}
                {['pending', 'needs_evidence'].includes(candidate.status) &&
                  writable && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={review.isPending || edit.isPending}
                        onClick={() => setEditing(candidate)}
                      >
                        编辑
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={review.isPending}
                        onClick={() =>
                          setReviewing({ candidate, action: 'reject' })
                        }
                      >
                        拒绝
                      </Button>
                      {candidate.status === 'pending' && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={review.isPending}
                          onClick={() =>
                            setReviewing({ candidate, action: 'merge' })
                          }
                        >
                          合并到已有情报
                        </Button>
                      )}
                      {candidate.status === 'pending' && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={review.isPending}
                          onClick={() =>
                            setReviewing({
                              candidate,
                              action: 'request_evidence',
                            })
                          }
                        >
                          要求补证
                        </Button>
                      )}
                      {candidate.status === 'pending' && (
                        <Button
                          size="sm"
                          disabled={review.isPending}
                          onClick={() =>
                            setReviewing({ candidate, action: 'approve' })
                          }
                        >
                          确认入库
                        </Button>
                      )}
                    </>
                  )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          title={`暂无${labels[status]}的候选`}
          description="可从情报收件箱补充线索，或整理研究报告。"
          action={
            <Button asChild variant="outline">
              <Link to="/research">前往研究</Link>
            </Button>
          }
        />
      )}
      {reviewing && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !review.isPending) setReviewing(null);
          }}
        >
          <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>{reviewLabels[reviewing.action]}</DialogTitle>
              <DialogDescription>{reviewing.candidate.title}</DialogDescription>
            </DialogHeader>
            {['approve', 'merge'].includes(reviewing.action) && (
              <ul className="space-y-3 text-sm">
                {reviewing.candidate.sources.map((source, i) => (
                  <li key={i} className="rounded-md border p-3">
                    <a
                      className="break-all underline"
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {source.title || source.url}
                    </a>
                    <p className="mt-2 whitespace-pre-wrap">
                      {source.evidence}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                const reason = String(form.get('reason') ?? '').trim();
                const targetId = String(form.get('targetId') ?? '');
                review.mutate({
                  ...reviewing,
                  reason: reason || undefined,
                  targetId: targetId || undefined,
                });
              }}
            >
              {reviewing.action === 'merge' && (
                <label className="block space-y-2 text-sm">
                  <span>关联情报</span>
                  <select
                    required
                    name="targetId"
                    className="h-9 w-full rounded-md border bg-background px-2"
                  >
                    <option value="">
                      {targets.isPending
                        ? '正在加载'
                        : targets.isError
                          ? '加载失败'
                          : '请选择同一事件'}
                    </option>
                    {targets.data?.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {reviewing.action !== 'approve' && (
                <div className="space-y-2">
                  <Label htmlFor="review-reason">
                    {reviewing.action === 'reject'
                      ? '拒绝原因'
                      : reviewing.action === 'merge'
                        ? '判定为同一事件的依据'
                        : '需要补充的证据'}
                  </Label>
                  <Textarea
                    id="review-reason"
                    name="reason"
                    required
                    maxLength={500}
                  />
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  type="button"
                  onClick={() => setReviewing(null)}
                  disabled={review.isPending}
                >
                  取消
                </Button>
                <Button type="submit" disabled={review.isPending}>
                  {reviewLabels[reviewing.action]}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      )}
      {editing && (
        <CandidateEditor
          candidate={editing}
          busy={edit.isPending}
          onSave={(payload) => edit.mutate(payload)}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

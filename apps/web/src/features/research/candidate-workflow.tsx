import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  canWrite,
  type CandidateBatch,
  type RunStatus,
} from '@guangmo/contracts';
import { toast } from 'sonner';
import { api, post } from '@/lib/api';
import { integrationQuery, memberQuery } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/page-state';
export function CandidateWorkflow({
  runId,
  researchStatus,
}: {
  runId: string;
  researchStatus: RunStatus;
}) {
  const client = useQueryClient();
  const member = useQuery(memberQuery);
  const integration = useQuery(integrationQuery);
  const query = useQuery({
    queryKey: ['candidate-batch', runId, researchStatus],
    queryFn: () => api<CandidateBatch>(`/research/${runId}/candidates`),
    refetchInterval: (q) =>
      researchStatus === 'running' ||
      researchStatus === 'queued' ||
      ['queued', 'running'].includes(q.state.data?.extraction?.status ?? '')
        ? 3000
        : false,
  });
  const create = useMutation({
    mutationFn: () => post(`/research/${runId}/extraction`, {}),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ['candidate-batch', runId, researchStatus],
      });
      toast.success('已开始整理情报');
    },
    onError: (error) => toast.error(error.message),
  });
  if (query.error)
    return (
      <ErrorState error={query.error} retry={() => void query.refetch()} />
    );
  if (researchStatus !== 'succeeded' || !query.data) return null;
  const { extraction, candidates } = query.data;
  const label = !extraction
    ? '可整理为候选情报'
    : extraction.status === 'queued'
      ? '等待整理情报'
      : extraction.status === 'running'
        ? '正在整理情报'
        : extraction.status === 'failed'
          ? '情报整理未完成'
          : candidates.length
            ? `${candidates.length} 条候选情报 · ${candidates.filter((v) => v.status === 'pending').length} 条待审核`
            : '未发现可入库的新情报';
  return (
    <section
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 p-4"
      aria-label="情报整理"
    >
      <p role="status" className="text-sm">
        {label}
      </p>
      {extraction?.status === 'succeeded' && candidates.length > 0 ? (
        <Button size="sm" variant="outline" asChild>
          <Link to={`/candidates?run=${runId}`}>查看候选情报</Link>
        </Button>
      ) : (!extraction || extraction.status === 'failed') &&
        canWrite(member.data?.role ?? 'viewer') ? (
        <Button
          size="sm"
          variant="outline"
          disabled={
            create.isPending ||
            !integration.data?.agentConfigured ||
            !integration.data.queueAvailable
          }
          onClick={() => create.mutate()}
        >
          {extraction ? '重试整理' : '整理情报'}
        </Button>
      ) : null}
    </section>
  );
}

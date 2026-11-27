import { OwnerAssignment } from './owner-assignment';
import { OpportunityScorePanel } from '@/components/opportunity-score';
import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  claimTypeLabels,
  taskStatusLabels,
  type CandidateInput,
  type IntelligenceEvidence,
  type IntelligenceListItem,
  type WorkflowTask,
} from '@guangmo/contracts';
import { toast } from 'sonner';
import { api, post } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ErrorState } from '@/components/page-state';
import {
  InformationTimes,
  SourceTimeDetails,
} from '@/components/information-times';
import { TaskEditor, type TaskFormValue } from '../tasks/task-editor';
export interface IntelligenceDetail extends IntelligenceListItem {
  sources: IntelligenceEvidence[];
  tasks: WorkflowTask[];
  metadata: Pick<
    CandidateInput,
    | 'claimType'
    | 'publishedAt'
    | 'language'
    | 'tags'
    | 'suggestedAction'
    | 'eventStartsAt'
    | 'eventEndsAt'
    | 'sourceTimes'
  > | null;
}
export function EvidenceAndTasks({
  id,
  writable,
}: {
  id: string;
  writable: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['intelligence-detail', id],
    queryFn: () => api<IntelligenceDetail>(`/intelligence/${id}`),
    refetchInterval: 5000,
  });
  const create = useMutation({
    mutationFn: (value: TaskFormValue) =>
      post<WorkflowTask>(`/intelligence/${id}/tasks`, value),
    onSuccess: (task) => {
      setCreating(false);
      void client.invalidateQueries({ queryKey: ['tasks'] });
      void client.invalidateQueries({ queryKey: ['intelligence'] });
      void client.invalidateQueries({ queryKey: ['intelligence-detail', id] });
      toast.success('任务已保存', {
        action: {
          label: '查看',
          onClick: () => window.location.assign(`/tasks?task=${task.id}`),
        },
      });
    },
    onError: (error) => toast.error(error.message),
  });
  if (query.error) return <ErrorState error={query.error} />;
  if (!query.data) return null;
  const item = query.data;
  return (
    <>
      <OwnerAssignment item={item} writable={writable} />
      <OpportunityScorePanel
        score={item.scoring}
        type="intelligence"
        id={id}
        writable={writable}
      />
      {item.metadata && (
        <div className="space-y-2 rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">
              {claimTypeLabels[item.metadata.claimType]}
            </Badge>
            <span>语言：{item.metadata.language ?? '未知'}</span>
          </div>
          <InformationTimes
            primaryUrl={item.sourceUrl}
            value={item.metadata}
            collectedAt={item.createdAt}
          />
          {item.metadata.tags.length > 0 && (
            <p>{item.metadata.tags.join(' · ')}</p>
          )}
          {item.metadata.suggestedAction && (
            <p className="leading-6">
              建议行动：{item.metadata.suggestedAction}
            </p>
          )}
        </div>
      )}
      {item.sources.length > 0 && (
        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm">
            来源与依据 · {item.sources.length}
          </summary>
          <ul className="mt-3 space-y-4">
            {item.sources.map((source) => (
              <li key={source.id}>
                <a
                  className="break-all text-xs underline underline-offset-4"
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {source.title || source.url}
                </a>
                <p className="mt-1 whitespace-pre-wrap text-xs leading-6 text-muted-foreground">
                  {source.evidence}
                </p>
                <SourceTimeDetails
                  value={item.metadata?.sourceTimes?.find(
                    (time) => time.url === source.url,
                  )}
                />
                {source.runId && (
                  <Link
                    className="mt-1 inline-block text-xs text-primary underline"
                    to={`/research?run=${source.runId}`}
                  >
                    查看原研究
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      <section className="space-y-3 border-t pt-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium">关联任务</h3>
          {writable && item.status === 'verified' && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setCreating(true)}
            >
              转为任务
            </Button>
          )}
        </div>
        {item.tasks.length ? (
          item.tasks.map((task) => (
            <Link
              key={task.id}
              to={`/tasks?task=${task.id}`}
              className="block rounded-lg border p-3"
            >
              <div className="flex items-center gap-2">
                <Badge variant="outline">{taskStatusLabels[task.status]}</Badge>
                <span className="text-sm">{task.title}</span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                执行负责人：
                {item.taskSummary.find((summary) => summary.id === task.id)
                  ?.assigneeName ?? '成员不可用'}{' '}
                · {task.channel}
              </p>
              {task.result && (
                <p className="mt-2 line-clamp-2 text-xs leading-6 text-muted-foreground">
                  {task.result}
                </p>
              )}
            </Link>
          ))
        ) : (
          <p className="text-xs text-muted-foreground">
            {item.status === 'verified'
              ? '暂无关联任务。'
              : '确认情报有效后可创建任务。'}
          </p>
        )}
      </section>
      {creating && (
        <TaskEditor
          title={item.title}
          busy={create.isPending}
          onSave={(value) => create.mutate(value)}
          onClose={() => setCreating(false)}
        />
      )}
    </>
  );
}

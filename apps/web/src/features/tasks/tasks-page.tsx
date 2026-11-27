import { ProductName } from '@/features/products/product-context';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  canWrite,
  taskStatusLabels,
  type Assignee,
  type TaskStatus,
  type WorkflowTask,
} from '@guangmo/contracts';
import { toast } from 'sonner';
import { api, dateTime } from '@/lib/api';
import { memberQuery } from '@/lib/queries';
import {
  PageHeading,
  EmptyState,
  ErrorState,
  Loading,
} from '@/components/page-state';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { TaskEditor, type TaskFormValue } from './task-editor';

const taskStatusVariant: Record<
  TaskStatus,
  'neutral' | 'info' | 'warning' | 'success' | 'danger'
> = {
  pending: 'warning',
  in_progress: 'info',
  in_review: 'info',
  completed: 'success',
  failed: 'danger',
  cancelled: 'neutral',
};

const priorityMeta = {
  low: { label: '低', variant: 'neutral' as const },
  normal: { label: '普通', variant: 'info' as const },
  high: { label: '高', variant: 'danger' as const },
};

const statusTabs: { value: string; label: string }[] = [
  { value: 'all', label: '全部状态' },
  ...Object.entries(taskStatusLabels).map(([value, label]) => ({
    value,
    label,
  })),
];

export default function TasksPage() {
  const [params, setParams] = useSearchParams();
  const id = params.get('task');
  const [status, setStatus] = useState('all');
  const [editing, setEditing] = useState(false);
  const client = useQueryClient();
  const member = useQuery(memberQuery);
  const query = useQuery({
    queryKey: ['tasks'],
    queryFn: () => api<WorkflowTask[]>('/tasks'),
    refetchInterval: 10000,
  });
  const detail = useQuery({
    queryKey: ['task-detail', id],
    queryFn: () => api<WorkflowTask>(`/tasks/${id}`),
    enabled: !!id,
  });
  const assignees = useQuery({
    queryKey: ['task-assignees'],
    queryFn: () => api<Assignee[]>('/tasks/assignees'),
  });
  const update = useMutation({
    mutationFn: (value: TaskFormValue) => {
      const changes = {
        title: value.title,
        channel: value.channel,
        assigneeId: value.assigneeId,
        dueAt: value.dueAt,
        priority: value.priority,
        status: value.status,
        result: value.result,
      };
      return api(`/tasks/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...changes, revision: detail.data!.revision }),
      });
    },
    onSuccess: () => {
      setEditing(false);
      for (const key of ['tasks', 'task-detail', 'intelligence-detail'])
        void client.invalidateQueries({ queryKey: [key] });
      toast.success('任务已更新');
    },
    onError: (error) => {
      toast.error(error.message);
      void client.invalidateQueries({ queryKey: ['task-detail', id] });
    },
  });

  const task = detail.data;
  const rows = (query.data ?? []).filter(
    (v) => status === 'all' || v.status === status,
  );

  return (
    <>
      <PageHeading
        title="任务中心"
        description="跟踪由情报转出的选题与建联任务，回写执行结果。"
        action={
          <Button variant="outline" asChild>
            <Link to="/intelligence">前往情报收件箱</Link>
          </Button>
        }
      />

      <nav
        aria-label="筛选任务状态"
        className="mb-3 flex flex-wrap gap-1 rounded-lg border bg-card px-3 pt-1"
      >
        {statusTabs.map((tab) => {
          const count =
            tab.value === 'all'
              ? (query.data?.length ?? 0)
              : (query.data?.filter((v) => v.status === tab.value).length ?? 0);
          return (
            <button
              key={tab.value}
              type="button"
              aria-current={status === tab.value ? 'page' : undefined}
              className={cn(
                '-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] transition-colors',
                status === tab.value
                  ? 'border-primary font-medium text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
              onClick={() => setStatus(tab.value)}
            >
              <span>{tab.label}</span>
              {query.data && (
                <span className="text-[11px] tabular-nums opacity-75">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : rows.length ? (
        <div className="overflow-hidden rounded-lg border bg-card">
          <Table className="min-w-[860px]">
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">任务名称</TableHead>
                <TableHead>类型</TableHead>
                <TableHead>产品 · 市场</TableHead>
                <TableHead>执行渠道</TableHead>
                <TableHead>优先级</TableHead>
                <TableHead>负责人</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>截止时间</TableHead>
                <TableHead className="pr-4 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((item) => {
                const priority = priorityMeta[item.priority];
                const assigneeName =
                  assignees.data?.find((v) => v.id === item.assigneeId)?.name ??
                  '未在可分配列表中';
                return (
                  <TableRow key={item.id}>
                    <TableCell className="max-w-sm pl-4 whitespace-normal">
                      <button
                        type="button"
                        className="text-left font-medium text-foreground hover:text-primary hover:underline"
                        onClick={() => setParams({ task: item.id })}
                      >
                        {item.title}
                      </button>
                      {item.result && (
                        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                          结果：{item.result}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="neutral">
                        {item.kind === 'content' ? '选题' : '建联'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      <div className="text-foreground">
                        <ProductName id={item.product} />
                      </div>
                      <div className="text-muted-foreground">{item.market}</div>
                    </TableCell>
                    <TableCell className="text-xs text-foreground">
                      {item.channel}
                    </TableCell>
                    <TableCell>
                      <Badge variant={priority.variant}>{priority.label}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-foreground">
                      {assigneeName}
                    </TableCell>
                    <TableCell>
                      <Badge variant={taskStatusVariant[item.status]}>
                        {taskStatusLabels[item.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs tabular-nums text-muted-foreground">
                      {item.dueAt ? dateTime(item.dueAt) : '未设置'}
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setParams({ task: item.id })}
                      >
                        查看详情
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <div className="border-t px-4 py-2.5 text-xs text-muted-foreground">
            显示 {rows.length} 条任务 · 最多展示最新 100 条
          </div>
        </div>
      ) : (
        <EmptyState
          title="当前没有任务"
          description="在已确认的情报中创建选题或建联任务。"
          action={
            <Button asChild size="sm" variant="outline">
              <Link to="/intelligence">查看情报</Link>
            </Button>
          }
        />
      )}

      <Dialog
        open={!!id && !editing}
        onOpenChange={(open) => {
          if (!open) setParams({});
        }}
      >
        <DialogContent className="max-h-[90svh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{task?.title ?? '任务详情'}</DialogTitle>
            <DialogDescription>
              {task ? (
                <>
                  <ProductName id={task.product} /> · {task.market} ·{' '}
                  {task.channel}
                </>
              ) : (
                '查看进度与结果'
              )}
            </DialogDescription>
          </DialogHeader>
          {detail.isPending ? (
            <Loading />
          ) : detail.error ? (
            <ErrorState error={detail.error} />
          ) : (
            task && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={taskStatusVariant[task.status]}>
                    {taskStatusLabels[task.status]}
                  </Badge>
                  <Badge variant={priorityMeta[task.priority].variant}>
                    优先级：{priorityMeta[task.priority].label}
                  </Badge>
                  <Badge variant="neutral">
                    {task.kind === 'content' ? '选题' : '建联'}
                  </Badge>
                </div>
                {task.brief && (
                  <div className="rounded-md border bg-muted/40 p-3.5">
                    <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                      任务要求
                    </p>
                    <p className="whitespace-pre-wrap text-[13px] leading-6">
                      {task.brief}
                    </p>
                  </div>
                )}
                <div className="rounded-md border p-3.5">
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                    执行结果
                  </p>
                  <p className="whitespace-pre-wrap text-[13px] leading-6">
                    {task.result || '尚未填写执行结果。'}
                  </p>
                </div>
                <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
                  <Button variant="outline" asChild>
                    <Link to={`/intelligence?item=${task.intelligenceId}`}>
                      查看情报与证据
                    </Link>
                  </Button>
                  {canWrite(member.data?.role ?? 'viewer') && (
                    <Button onClick={() => setEditing(true)}>更新任务</Button>
                  )}
                </div>
              </>
            )
          )}
        </DialogContent>
      </Dialog>

      {editing && task && (
        <TaskEditor
          key={`${task.id}-${task.revision}`}
          title={task.title}
          task={task}
          busy={update.isPending}
          onSave={(value) => update.mutate(value)}
          onClose={() => setEditing(false)}
        />
      )}
    </>
  );
}

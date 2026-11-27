import { useQuery } from '@tanstack/react-query';
import type { Assignee, TaskInput, WorkflowTask } from '@guangmo/contracts';
import {
  taskInput,
  taskStatusLabels,
  taskTransitions,
} from '@guangmo/contracts';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ChoiceSelect } from '@/components/choice-select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { ErrorState, Loading } from '@/components/page-state';
export type TaskFormValue = TaskInput & {
  status?: WorkflowTask['status'];
  result?: string;
};
export function TaskEditor({
  title,
  task,
  busy,
  onSave,
  onClose,
}: {
  title: string;
  task?: WorkflowTask;
  busy: boolean;
  onSave: (value: TaskFormValue) => void;
  onClose: () => void;
}) {
  const members = useQuery({
    queryKey: ['task-assignees'],
    queryFn: () => api<Assignee[]>('/tasks/assignees'),
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{task ? '更新任务' : '情报转任务'}</DialogTitle>
          <DialogDescription>
            关联情报与来源，记录负责人和执行结果。
          </DialogDescription>
        </DialogHeader>
        {members.isPending ? (
          <Loading />
        ) : members.error ? (
          <ErrorState error={members.error} />
        ) : (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              const f = new FormData(event.currentTarget);
              const value = {
                title: f.get('title'),
                kind: task?.kind ?? f.get('kind'),
                channel: f.get('channel'),
                assigneeId: f.get('assigneeId'),
                dueAt: f.get('dueAt')
                  ? new Date(String(f.get('dueAt'))).toISOString()
                  : null,
                priority: f.get('priority'),
              };
              const parsed = taskInput.safeParse(value);
              if (!parsed.success) {
                toast.error(
                  parsed.error.issues[0]?.message ?? '请检查填写内容',
                );
                return;
              }
              onSave({
                ...parsed.data,
                ...(task
                  ? {
                      status: String(f.get('status')) as WorkflowTask['status'],
                      result: String(f.get('result')),
                    }
                  : {}),
              });
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="task-title">任务名称</Label>
              <Input
                id="task-title"
                name="title"
                defaultValue={task?.title ?? title}
                required
                minLength={2}
                maxLength={200}
              />
            </div>
            {!task && (
              <div className="space-y-2">
                <Label>任务类型</Label>
                <ChoiceSelect
                  label="任务类型"
                  name="kind"
                  defaultValue="content"
                  options={[
                    { value: 'content', label: '选题任务' },
                    { value: 'outreach', label: '建联任务' },
                  ]}
                />
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>负责人</Label>
                <ChoiceSelect
                  label="负责人"
                  name="assigneeId"
                  defaultValue={task?.assigneeId}
                  options={members.data.map((m) => ({
                    value: m.id,
                    label: m.name,
                  }))}
                />
                {task &&
                  !members.data.some((m) => m.id === task.assigneeId) && (
                    <p className="text-xs text-destructive">
                      原负责人不可用，请重新选择。
                    </p>
                  )}
              </div>
              <div className="space-y-2">
                <Label>优先级</Label>
                <ChoiceSelect
                  label="优先级"
                  name="priority"
                  defaultValue={task?.priority ?? 'normal'}
                  options={[
                    { value: 'low', label: '低' },
                    { value: 'normal', label: '普通' },
                    { value: 'high', label: '高' },
                  ]}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="task-channel">渠道</Label>
              <Input
                id="task-channel"
                name="channel"
                defaultValue={task?.channel ?? ''}
                placeholder="例如 TikTok、Instagram、邮件"
                required
                maxLength={80}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="task-due">截止时间</Label>
              <Input
                id="task-due"
                name="dueAt"
                type="datetime-local"
                defaultValue={
                  task?.dueAt
                    ? new Date(
                        Date.parse(task.dueAt) -
                          new Date(task.dueAt).getTimezoneOffset() * 60000,
                      )
                        .toISOString()
                        .slice(0, 16)
                    : ''
                }
              />
            </div>
            {task && (
              <>
                <div className="space-y-2">
                  <Label>状态</Label>
                  <ChoiceSelect
                    label="任务状态"
                    name="status"
                    defaultValue={task.status}
                    options={[task.status, ...taskTransitions[task.status]].map(
                      (value) => ({ value, label: taskStatusLabels[value] }),
                    )}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="task-result">结果 / 失败原因</Label>
                  <Textarea
                    id="task-result"
                    name="result"
                    defaultValue={task.result ?? ''}
                    rows={5}
                    maxLength={12000}
                  />
                </div>
              </>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={onClose}
              >
                取消
              </Button>
              <Button disabled={busy || members.data.length === 0}>
                {busy ? '保存中…' : '保存任务'}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
